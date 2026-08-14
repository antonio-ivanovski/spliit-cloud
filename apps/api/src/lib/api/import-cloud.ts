import {
  GroupMemberStatus,
  GroupRole,
  LedgerParticipantKind,
  prisma,
  type Prisma,
} from '@spliit/db'
import {
  wallTimeToUtc,
  SETTLEMENT_CATEGORY_ID,
  isSettlementCategory,
  spliitGroupExportManifestSchema,
  toSecondPrecision,
  type SpliitGroupExportManifest,
} from '@spliit/domain'

import {
  deleteS3Object,
  verifyAndPromoteCloudImportDocument,
} from '../../routes/upload'
import { getWebBaseUrl } from '../auth/urls'
import {
  assertInvitationRouteIdDoesNotMatchGroup,
  generateUniqueGroupRouteId,
} from '../group-route'
import {
  LINK_INVITATION_DEFAULT_TTL_MS,
  buildLinkPlaceholderEmail,
  hashLinkToken,
} from '../invitations'
import { isPlaceholderEmail } from '../invitations/display'
import { buildImportSummaryActivityData, logActivity } from './activities'
import { createFriendLedger, type CreateFriendLedgerPeer } from './friends'
import { enqueueMaterialization } from './recurrence/series-ops'
import { randomId } from './shared'

export type CloudImportParticipantMapping = {
  sourceParticipantId: string
  sourceName: string
  mode:
    | 'LINK_ACCOUNT'
    | 'INVITE_BY_EMAIL'
    | 'INVITE_BY_LINK'
    | 'UNLINKED_PARTICIPANT'
    | 'INVITE_CONTACT'
  linkedAccountId?: string
  email?: string
}

export type CloudImportInput = {
  manifest: SpliitGroupExportManifest
  groupFormValues: {
    name: string
    information?: string | null
    currency: string
    currencyCode?: string | null
  }
  archived: boolean
  participants: CloudImportParticipantMapping[]
  stagedDocuments: {
    sessionId: string
    documents: Array<{ sourceDocumentId: string; stagedToken: string }>
  }
  skippedDocumentIds: string[]
  acknowledgedIssues: boolean
  groupPreference?: {
    starred: boolean
    hidden: boolean
    defaultSplit: {
      splitMode: 'EVENLY' | 'BY_SHARES' | 'BY_PERCENTAGE' | 'BY_AMOUNT'
      paidFor: Array<{ participantId: string; shares: number }>
    } | null
  }
}

export type CloudImportResult = {
  groupId: string
  ledgerId: string
  importedExpenses: number
  importedDocuments: number
  sourceGroupId: string
  invites: Array<{
    sourceName: string
    kind: 'EMAIL' | 'LINK'
    invitationId: string
    inviteUrl?: string
    email?: string
  }>
  promotedDocumentUrls: string[]
}

type PreparedCloudImport = {
  documents: Map<
    string,
    {
      url: string
      temporaryUrl: string
      fileName: string | null
      contentType: string | null
      sha256: string
      width: number | null
      height: number | null
    }
  >
  promotedDocumentUrls: string[]
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function asDate(value: string): Date {
  return new Date(value)
}

function isSafeArchivePath(path: string): boolean {
  const segments = path.split('/')
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    segments.every(
      (segment) => segment.length > 0 && segment !== '.' && segment !== '..',
    )
  )
}

function mapRows(
  rows: ReadonlyArray<{ participantId: string; shares: number }>,
  participantIds: Map<string, string>,
) {
  return rows.map((row) => ({
    ledgerParticipantId: participantIds.get(row.participantId)!,
    shares: row.shares,
  }))
}

function remapTemplate(
  template: Record<string, unknown>,
  participantIds: Map<string, string>,
) {
  const remap = (value: unknown) => {
    if (!Array.isArray(value)) return []
    return value.map((row) => {
      const item = row as { ledgerParticipantId: string; shares: number }
      return {
        ledgerParticipantId: participantIds.get(item.ledgerParticipantId)!,
        shares: item.shares,
      }
    })
  }
  const { isReimbursement, ...rest } = template
  return {
    ...rest,
    ...(isReimbursement === true ? { categoryId: SETTLEMENT_CATEGORY_ID } : {}),
    paidByList: remap(template.paidByList),
    paidFor: remap(template.paidFor),
    items: Array.isArray(template.items)
      ? template.items.map((item) => ({
          ...(item as Record<string, unknown>),
          paidFor: remap((item as Record<string, unknown>).paidFor),
        }))
      : [],
    itemizedRemainder: template.itemizedRemainder
      ? {
          ...(template.itemizedRemainder as Record<string, unknown>),
          paidFor: remap(
            (template.itemizedRemainder as Record<string, unknown>).paidFor,
          ),
        }
      : null,
  }
}

function manifestDocuments(manifest: SpliitGroupExportManifest) {
  return [
    ...manifest.expenses.flatMap((expense) => expense.documents),
    ...manifest.orphanDocuments,
  ]
}

function ensureUniqueShareRows(
  rows: ReadonlyArray<{
    participantId?: string
    ledgerParticipantId?: string
  }>,
  label: string,
) {
  const ids = rows.map((row) => row.participantId ?? row.ledgerParticipantId)
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Cloud ${label} contains duplicate participant rows`)
  }
}

function validateReferences(
  manifest: SpliitGroupExportManifest,
  mappings: CloudImportParticipantMapping[],
  inputGroupPreference?: CloudImportInput['groupPreference'],
) {
  if (manifest.scope.sourceId !== manifest.group.sourceId) {
    throw new Error('Cloud bundle scope does not match its group')
  }
  const participants = new Set(manifest.participants.map((row) => row.sourceId))
  if (participants.size !== manifest.participants.length) {
    throw new Error('Cloud bundle contains duplicate participant IDs')
  }
  const mappingIds = mappings.map((row) => row.sourceParticipantId)
  if (
    new Set(mappingIds).size !== mappingIds.length ||
    mappingIds.length !== participants.size ||
    mappingIds.some((id) => !participants.has(id))
  ) {
    throw new Error('Every Cloud participant must have exactly one mapping')
  }
  for (const mapping of mappings) {
    if (!mapping.sourceName.trim()) throw new Error('Participant name is empty')
    if (
      mapping.mode === 'INVITE_BY_EMAIL' ||
      mapping.mode === 'INVITE_CONTACT'
    ) {
      if (!mapping.email || isPlaceholderEmail(mapping.email)) {
        throw new Error('Email invitation mapping is invalid')
      }
    }
  }

  if (manifest.group.groupType === 'FRIEND') {
    if (manifest.group.archived) {
      throw new Error('Friend ledgers cannot be restored as archived')
    }
    if (manifest.group.subgroupsEnabled || manifest.subgroups.length > 0) {
      throw new Error('Friend ledgers cannot contain subgroups')
    }
    if (manifest.participants.length !== 2) {
      throw new Error('Friend ledgers must contain exactly two participants')
    }
    const linkedRows = mappings.filter(
      (mapping) => mapping.mode === 'LINK_ACCOUNT',
    )
    if (linkedRows.length !== 1) {
      throw new Error('Friend ledgers must map exactly one participant to you')
    }
    const peer = mappings.find(
      (mapping) =>
        mapping.sourceParticipantId !== linkedRows[0]!.sourceParticipantId,
    )
    if (
      !peer ||
      (peer.mode !== 'INVITE_BY_EMAIL' &&
        peer.mode !== 'INVITE_CONTACT' &&
        peer.mode !== 'INVITE_BY_LINK')
    ) {
      throw new Error(
        'Friend ledgers must map the other participant to a contact, email, or link',
      )
    }
  }
  const invitationEmails = new Set<string>()
  for (const mapping of mappings) {
    if (
      mapping.mode !== 'INVITE_BY_EMAIL' &&
      mapping.mode !== 'INVITE_CONTACT'
    ) {
      continue
    }
    const email = mapping.email!.trim().toLowerCase()
    if (invitationEmails.has(email)) {
      throw new Error('Cloud bundle contains duplicate invitation emails')
    }
    invitationEmails.add(email)
  }

  const seriesIds = new Set(
    manifest.recurrenceSeries.map((row) => row.sourceId),
  )
  if (seriesIds.size !== manifest.recurrenceSeries.length) {
    throw new Error('Cloud bundle contains duplicate recurrence series IDs')
  }
  if (
    new Set(manifest.expenses.map((row) => row.sourceId)).size !==
    manifest.expenses.length
  ) {
    throw new Error('Cloud bundle contains duplicate expense IDs')
  }
  if (
    new Set(manifest.subgroups.map((row) => row.sourceId)).size !==
    manifest.subgroups.length
  ) {
    throw new Error('Cloud bundle contains duplicate subgroup IDs')
  }
  if (
    new Set(manifest.budgets.map((row) => row.sourceId)).size !==
    manifest.budgets.length
  ) {
    throw new Error('Cloud bundle contains duplicate budget IDs')
  }
  const documentIds = new Set<string>()
  const documentPaths = new Set<string>()
  const itemIds = new Set<string>()
  const documents = manifestDocuments(manifest)
  for (const warning of manifest.warnings) {
    if (
      !documents.some((document) => document.sourceId === warning.documentId)
    ) {
      throw new Error('Cloud bundle warning references an unknown document')
    }
    if (warning.path !== null && !isSafeArchivePath(warning.path)) {
      throw new Error('Cloud bundle warning path is unsafe')
    }
  }
  for (const document of documents) {
    if (documentIds.has(document.sourceId)) {
      throw new Error('Cloud bundle contains duplicate document IDs')
    }
    documentIds.add(document.sourceId)
    if (document.status === 'MISSING') {
      if (document.path !== null) {
        throw new Error('Missing Cloud documents must have a null path')
      }
    } else if (document.status === 'OMITTED') {
      if (
        document.path !== null ||
        document.sizeBytes !== null ||
        document.sha256 !== null
      ) {
        throw new Error('Omitted Cloud documents must not contain archive data')
      }
    } else {
      if (!document.path || !isSafeArchivePath(document.path)) {
        throw new Error('Cloud document path is unsafe')
      }
      if (documentPaths.has(document.path)) {
        throw new Error('Cloud bundle contains duplicate document paths')
      }
      documentPaths.add(document.path)
      if (document.sizeBytes === null || document.sha256 === null) {
        throw new Error('Included Cloud documents require size and checksum')
      }
    }
  }
  const ensureParticipant = (id: string) => {
    if (!participants.has(id))
      throw new Error('Cloud bundle references an unknown participant')
  }
  const commentIds = new Set<string>()
  for (const subgroup of manifest.subgroups) {
    if (
      new Set(subgroup.participantIds).size !== subgroup.participantIds.length
    ) {
      throw new Error('Cloud subgroup contains duplicate participants')
    }
    for (const id of subgroup.participantIds) ensureParticipant(id)
  }
  const subgroupParticipants = new Set<string>()
  for (const subgroup of manifest.subgroups) {
    for (const id of subgroup.participantIds) {
      if (subgroupParticipants.has(id)) {
        throw new Error('Cloud participant belongs to multiple subgroups')
      }
      subgroupParticipants.add(id)
    }
  }
  for (const budget of manifest.budgets) {
    for (const id of budget.participantIds) ensureParticipant(id)
  }
  for (const series of manifest.recurrenceSeries) {
    if (series.creatorParticipantId)
      ensureParticipant(series.creatorParticipantId)
    const template = series.template as unknown as Record<string, unknown>
    ensureUniqueShareRows(
      (Array.isArray(template.paidByList) ? template.paidByList : []) as Array<{
        ledgerParticipantId: string
      }>,
      'recurrence payer list',
    )
    ensureUniqueShareRows(
      (Array.isArray(template.paidFor) ? template.paidFor : []) as Array<{
        ledgerParticipantId: string
      }>,
      'recurrence share list',
    )
    for (const row of [
      ...(Array.isArray(template.paidByList) ? template.paidByList : []),
      ...(Array.isArray(template.paidFor) ? template.paidFor : []),
    ]) {
      ensureParticipant(
        (row as { ledgerParticipantId: string }).ledgerParticipantId,
      )
    }
    const templateItems = Array.isArray(template.items) ? template.items : []
    for (const item of templateItems) {
      ensureUniqueShareRows(
        ((item as { paidFor?: unknown[] }).paidFor ?? []) as Array<{
          ledgerParticipantId: string
        }>,
        'recurrence item share list',
      )
      for (const row of (item as { paidFor?: unknown[] }).paidFor ?? []) {
        ensureParticipant(
          (row as { ledgerParticipantId: string }).ledgerParticipantId,
        )
      }
    }
    const remainder = template.itemizedRemainder as
      | { paidFor?: unknown[] }
      | null
      | undefined
    ensureUniqueShareRows(
      (remainder?.paidFor ?? []) as Array<{ ledgerParticipantId: string }>,
      'recurrence remainder share list',
    )
    for (const row of remainder?.paidFor ?? []) {
      ensureParticipant(
        (row as { ledgerParticipantId: string }).ledgerParticipantId,
      )
    }
  }
  for (const expense of manifest.expenses) {
    if (expense.createdByParticipantId)
      ensureParticipant(expense.createdByParticipantId)
    if (
      expense.recurringSeriesId &&
      !seriesIds.has(expense.recurringSeriesId)
    ) {
      throw new Error('Cloud expense references an unknown recurrence series')
    }
    ensureUniqueShareRows(expense.paidByList, 'expense payer list')
    ensureUniqueShareRows(expense.paidFor, 'expense share list')
    for (const row of [...expense.paidByList, ...expense.paidFor]) {
      ensureParticipant(row.participantId)
    }
    for (const item of expense.items) {
      if (itemIds.has(item.sourceId)) {
        throw new Error('Cloud bundle contains duplicate expense item IDs')
      }
      itemIds.add(item.sourceId)
      ensureUniqueShareRows(item.paidFor, 'expense item share list')
      for (const row of item.paidFor) ensureParticipant(row.participantId)
    }
    if (expense.itemizedRemainder) {
      ensureUniqueShareRows(
        expense.itemizedRemainder.paidFor,
        'expense remainder share list',
      )
      for (const row of expense.itemizedRemainder.paidFor)
        ensureParticipant(row.participantId)
    }
    for (const comment of expense.comments) {
      if (commentIds.has(comment.sourceId)) {
        throw new Error('Cloud bundle contains duplicate comment IDs')
      }
      commentIds.add(comment.sourceId)
      if (comment.authorParticipantId)
        ensureParticipant(comment.authorParticipantId)
    }
  }
  const defaultSplit = inputGroupPreference?.defaultSplit
  if (defaultSplit) {
    const defaultParticipantIds = defaultSplit.paidFor.map(
      (row) => row.participantId,
    )
    if (new Set(defaultParticipantIds).size !== defaultParticipantIds.length) {
      throw new Error('Cloud group preference contains duplicate participants')
    }
    for (const row of defaultSplit.paidFor) ensureParticipant(row.participantId)
  }
}

type FriendImportLedger = {
  groupId: string
  ledgerId: string
  destinationIds: Map<string, string>
  invites: CloudImportResult['invites']
}

/**
 * Create the destination through the same friend-ledger service used by the
 * Friends UI, then map the two source participants onto its fresh ledger
 * participants. This keeps pair uniqueness and pending invite semantics in one
 * place.
 */
async function createFriendImportLedger(
  manifest: SpliitGroupExportManifest,
  input: CloudImportInput,
  actor: { accountId: string },
  tx: Prisma.TransactionClient,
  mappingBySource: Map<string, CloudImportParticipantMapping>,
): Promise<FriendImportLedger> {
  const self = manifest.participants.find(
    (participant) =>
      mappingBySource.get(participant.sourceId)?.mode === 'LINK_ACCOUNT',
  )
  const peer = manifest.participants.find(
    (participant) => participant.sourceId !== self?.sourceId,
  )
  if (!self || !peer) {
    throw new Error('Friend ledger participant mappings are incomplete')
  }
  if (mappingBySource.get(self.sourceId)?.linkedAccountId !== actor.accountId) {
    throw new Error('Friend imports may only link the signed-in account')
  }
  const peerMapping = mappingBySource.get(peer.sourceId)!
  let peerTarget: CreateFriendLedgerPeer
  if (peerMapping.mode === 'INVITE_CONTACT' && peerMapping.linkedAccountId) {
    peerTarget = { accountId: peerMapping.linkedAccountId }
  } else if (
    peerMapping.mode === 'INVITE_BY_EMAIL' ||
    peerMapping.mode === 'INVITE_CONTACT'
  ) {
    const email = peerMapping.email!.trim().toLowerCase()
    const account = await tx.account.findUnique({
      where: { email },
      select: { id: true },
    })
    peerTarget = account
      ? { accountId: account.id }
      : { email, temporaryName: peer.displayName }
  } else if (peerMapping.mode === 'INVITE_BY_LINK') {
    peerTarget = { link: true, temporaryName: peer.displayName }
  } else {
    throw new Error('Friend ledger peer mapping is invalid')
  }
  if ('accountId' in peerTarget && peerTarget.accountId === actor.accountId) {
    throw new Error('You cannot restore a friend ledger with yourself')
  }
  if ('accountId' in peerTarget) {
    const peerAccount = await tx.account.findUnique({
      where: { id: peerTarget.accountId },
      select: { id: true },
    })
    if (!peerAccount)
      throw new Error('The selected friend account was not found')
  }

  const created = await createFriendLedger(
    {
      callerAccountId: actor.accountId,
      peer: peerTarget,
      currency: input.groupFormValues.currency,
      currencyCode: input.groupFormValues.currencyCode,
      information: input.groupFormValues.information,
    },
    tx,
  )
  if (created.existed) {
    throw new Error('A friend ledger with this participant already exists')
  }

  const group = await tx.group.findUnique({
    where: { id: created.groupId },
    select: { ledgerId: true },
  })
  if (!group) throw new Error('The restored friend ledger could not be found')

  const participants = await tx.ledgerParticipant.findMany({
    where: { ledgerId: group.ledgerId },
    select: {
      id: true,
      groupMember: { select: { accountId: true } },
      invitations: {
        where: { status: 'PENDING' },
        select: { type: true, email: true },
      },
    },
  })
  const actorParticipant = participants.find(
    (participant) => participant.groupMember?.accountId === actor.accountId,
  )
  const peerEmail = 'email' in peerTarget ? peerTarget.email : null
  const peerParticipant =
    'accountId' in peerTarget
      ? participants.find(
          (participant) =>
            participant.groupMember?.accountId === peerTarget.accountId,
        )
      : peerEmail
        ? participants.find((participant) =>
            participant.invitations.some(
              (invitation) =>
                invitation.type === 'EMAIL' &&
                invitation.email.toLowerCase() === peerEmail.toLowerCase(),
            ),
          )
        : participants.find((participant) =>
            participant.invitations.some(
              (invitation) => invitation.type === 'LINK',
            ),
          )
  if (!actorParticipant || !peerParticipant) {
    throw new Error(
      'The restored friend ledger participants could not be mapped',
    )
  }

  return {
    groupId: created.groupId,
    ledgerId: group.ledgerId,
    destinationIds: new Map([
      [self.sourceId, actorParticipant.id],
      [peer.sourceId, peerParticipant.id],
    ]),
    invites:
      !created.existed && 'invitationId' in created && created.invitationId
        ? [
            {
              sourceName: peer.displayName,
              kind: peerEmail ? ('EMAIL' as const) : ('LINK' as const),
              invitationId: created.invitationId,
              ...('inviteUrl' in created && created.inviteUrl
                ? { inviteUrl: created.inviteUrl }
                : {}),
              ...(peerEmail ? { email: peerEmail } : {}),
            },
          ]
        : [],
  }
}

export async function prepareCloudImport(
  input: CloudImportInput,
  actorAccountId: string,
): Promise<PreparedCloudImport> {
  const manifest = spliitGroupExportManifestSchema.parse(input.manifest)
  validateReferences(manifest, input.participants, input.groupPreference)
  if (
    input.groupFormValues.currency !== manifest.group.ledger.currency ||
    (input.groupFormValues.currencyCode || null) !==
      manifest.group.ledger.currencyCode
  ) {
    throw new Error('The imported group currency cannot be changed')
  }
  const docs = manifestDocuments(manifest)
  const documentIds = new Set(docs.map((document) => document.sourceId))
  const included = docs.filter((document) => document.status === 'INCLUDED')
  const skipped = new Set(input.skippedDocumentIds)
  if (skipped.size !== input.skippedDocumentIds.length) {
    throw new Error('Duplicate skipped Cloud documents')
  }
  if ([...skipped].some((id) => !documentIds.has(id))) {
    throw new Error('Unknown skipped Cloud document')
  }
  const stagedBySourceId = new Map(
    input.stagedDocuments.documents.map((document) => [
      document.sourceDocumentId,
      document.stagedToken,
    ]),
  )
  if (stagedBySourceId.size !== input.stagedDocuments.documents.length) {
    throw new Error('Duplicate staged Cloud documents')
  }
  const unknownStaged = [...stagedBySourceId.keys()].filter(
    (id) => !docs.some((document) => document.sourceId === id),
  )
  if (unknownStaged.length > 0) throw new Error('Unknown staged Cloud document')
  const stagedMissing = docs.filter(
    (document) =>
      document.status === 'MISSING' && stagedBySourceId.has(document.sourceId),
  )
  if (stagedMissing.length > 0) {
    throw new Error('Missing Cloud documents cannot be staged')
  }
  const missingClaims = included.filter(
    (document) =>
      !stagedBySourceId.has(document.sourceId) &&
      !skipped.has(document.sourceId),
  )
  if (missingClaims.length > 0) {
    throw new Error(
      'Every included document must be staged or explicitly skipped',
    )
  }
  if (skipped.size > 0 && !input.acknowledgedIssues) {
    throw new Error('Skipped Cloud documents require acknowledgement')
  }

  const promotedDocumentUrls: string[] = []
  const stagedDocumentUrls: string[] = []
  const documents = new Map<
    string,
    {
      url: string
      temporaryUrl: string
      fileName: string | null
      contentType: string | null
      sha256: string
      width: number | null
      height: number | null
    }
  >()
  try {
    for (const document of included) {
      const token = stagedBySourceId.get(document.sourceId)
      if (!token || skipped.has(document.sourceId)) continue
      const promoted = await verifyAndPromoteCloudImportDocument({
        token,
        accountId: actorAccountId,
        sessionId: input.stagedDocuments.sessionId,
      })
      // Record both URLs before comparing metadata. A malicious or stale
      // claim can fail the comparison after storage promotion; the catch block
      // must still remove that just-promoted object.
      promotedDocumentUrls.push(promoted.url)
      stagedDocumentUrls.push(promoted.temporaryUrl)
      if (
        promoted.sourceDocumentId !== document.sourceId ||
        promoted.fileSize !== document.sizeBytes ||
        promoted.fileName !== document.fileName ||
        promoted.contentType !== document.contentType ||
        promoted.sha256 !== document.sha256 ||
        promoted.width !== document.width ||
        promoted.height !== document.height
      ) {
        throw new Error(
          'Staged Cloud document metadata does not match the manifest',
        )
      }
      documents.set(document.sourceId, promoted)
    }
  } catch (error) {
    await Promise.allSettled(
      [...promotedDocumentUrls, ...stagedDocumentUrls].map((url) =>
        deleteS3Object(url),
      ),
    )
    throw error
  }
  return { documents, promotedDocumentUrls }
}

export async function importCloudGroup(
  input: CloudImportInput,
  actor: { accountId: string; email?: string | null },
  options: { tx?: Prisma.TransactionClient; prepared: PreparedCloudImport },
): Promise<CloudImportResult> {
  const manifest = spliitGroupExportManifestSchema.parse(input.manifest)
  validateReferences(manifest, input.participants, input.groupPreference)
  const run = async (tx: Prisma.TransactionClient) => {
    for (const mapping of input.participants) {
      if (
        (mapping.mode === 'INVITE_BY_EMAIL' ||
          mapping.mode === 'INVITE_CONTACT') &&
        actor.email &&
        mapping.email?.trim().toLowerCase() === actor.email.toLowerCase()
      ) {
        throw new Error('You cannot invite yourself to the imported group')
      }
    }
    const mappingBySource = new Map(
      input.participants.map((mapping) => [
        mapping.sourceParticipantId,
        mapping,
      ]),
    )
    const isFriendLedger = manifest.group.groupType === 'FRIEND'
    let ledger: { id: string; currencyCode: string | null }
    let group: { id: string }
    let destinationIds: Map<string, string>
    let friendInvites: CloudImportResult['invites'] = []

    if (isFriendLedger) {
      const friend = await createFriendImportLedger(
        manifest,
        input,
        actor,
        tx,
        mappingBySource,
      )
      ledger = {
        id: friend.ledgerId,
        currencyCode: input.groupFormValues.currencyCode || null,
      }
      group = { id: friend.groupId }
      destinationIds = friend.destinationIds
      friendInvites = friend.invites
    } else {
      const createdLedger = await tx.ledger.create({
        data: {
          id: randomId(),
          currency: input.groupFormValues.currency,
          currencyCode: input.groupFormValues.currencyCode || null,
          createdAt: asDate(manifest.group.ledger.createdAt),
        },
      })
      const createdGroup = await tx.group.create({
        data: {
          id: await generateUniqueGroupRouteId(tx),
          name: input.groupFormValues.name,
          information: input.groupFormValues.information ?? null,
          archived: false,
          groupType: 'GROUP',
          ledgerId: createdLedger.id,
          subgroupsEnabled: manifest.group.subgroupsEnabled,
          createdAt: asDate(manifest.group.createdAt),
        },
      })
      ledger = createdLedger
      group = createdGroup
      destinationIds = new Map<string, string>()
      const actorSourceIds: string[] = []
      for (const participant of manifest.participants) {
        const mapping = mappingBySource.get(participant.sourceId)!
        const destinationId = randomId()
        destinationIds.set(participant.sourceId, destinationId)
        if (mapping.mode === 'LINK_ACCOUNT') {
          if (mapping.linkedAccountId !== actor.accountId) {
            throw new Error('Cloud imports may only link the signed-in account')
          }
          actorSourceIds.push(participant.sourceId)
          const sourceJoinedAt = participant.membership?.joinedAt
            ? asDate(participant.membership.joinedAt)
            : new Date()
          const sourceCreatedAt = participant.membership?.createdAt
            ? asDate(participant.membership.createdAt)
            : sourceJoinedAt
          const sourceUpdatedAt = participant.membership?.updatedAt
            ? asDate(participant.membership.updatedAt)
            : sourceJoinedAt
          const member = await tx.groupMember.create({
            data: {
              id: randomId(),
              groupId: group.id,
              accountId: actor.accountId,
              role: GroupRole.ADMIN,
              status: GroupMemberStatus.ACTIVE,
              joinedAt: sourceJoinedAt,
              createdAt: sourceCreatedAt,
              updatedAt: sourceUpdatedAt,
            },
          })
          await tx.ledgerParticipant.create({
            data: {
              id: destinationId,
              ledgerId: ledger.id,
              groupMemberId: member.id,
              kind: LedgerParticipantKind.ACCOUNT_MEMBER,
              // Linking a source row to the signed-in account explicitly makes
              // that participant active in the new group, even when the source
              // row had previously been removed.
              removedAt: null,
            },
          })
        } else {
          await tx.ledgerParticipant.create({
            data: {
              id: destinationId,
              ledgerId: ledger.id,
              kind: LedgerParticipantKind.UNLINKED_PARTICIPANT,
              displayName: participant.displayName,
              removedAt: participant.removedAt
                ? asDate(participant.removedAt)
                : null,
            },
          })
        }
      }
      if (actorSourceIds.length > 1)
        throw new Error(
          'Cloud bundle maps the signed-in account more than once',
        )
      if (actorSourceIds.length === 0) {
        const member = await tx.groupMember.create({
          data: {
            id: randomId(),
            groupId: group.id,
            accountId: actor.accountId,
            role: GroupRole.ADMIN,
            status: GroupMemberStatus.ACTIVE,
            joinedAt: new Date(),
          },
        })
        await tx.ledgerParticipant.create({
          data: {
            id: randomId(),
            ledgerId: ledger.id,
            groupMemberId: member.id,
          },
        })
      }
    }

    const seriesIds = new Map<string, string>()
    const sourceSeriesById = new Map(
      manifest.recurrenceSeries.map((series) => [series.sourceId, series]),
    )
    for (const series of manifest.recurrenceSeries) {
      const destinationSeriesId = randomId()
      seriesIds.set(series.sourceId, destinationSeriesId)
      const creator = series.creatorParticipantId
        ? mappingBySource.get(series.creatorParticipantId)?.mode ===
          'LINK_ACCOUNT'
          ? actor.accountId
          : null
        : null
      const template = remapTemplate(
        series.template as unknown as Record<string, unknown>,
        destinationIds,
      )
      await tx.recurringExpenseSeries.create({
        data: {
          id: destinationSeriesId,
          ledgerId: ledger.id,
          creatorAccountId: creator,
          timeZone: series.timeZone,
          anchorTimeMinutes: series.anchorTimeMinutes ?? 900,
          frequency: series.frequency,
          interval: series.interval,
          anchorDate: dateOnly(series.anchorDate),
          anchorSequence: series.anchorSequence,
          nextOccurrenceDate: dateOnly(series.nextOccurrenceDate),
          nextOccurrenceOrdinal: series.nextOccurrenceOrdinal,
          endType: series.endType,
          occurrenceLimit: series.occurrenceLimit,
          endDate: series.endDate ? dateOnly(series.endDate) : null,
          occurrencesCreated: series.occurrencesCreated,
          status: series.status,
          template: template as never,
          version: series.version,
          createdAt: asDate(series.createdAt),
          updatedAt: asDate(series.updatedAt),
        },
      })
      if (series.status === 'ACTIVE') {
        await enqueueMaterialization(tx, {
          seriesId: destinationSeriesId,
          sequence: series.occurrencesCreated + 1,
          occurrenceDate: dateOnly(series.nextOccurrenceDate),
        })
      }
    }

    let importedDocuments = 0
    let totalAmount = 0
    for (const expense of manifest.expenses) {
      const expenseId = randomId()
      const categoryId = expense.isReimbursement
        ? SETTLEMENT_CATEGORY_ID
        : expense.categoryId
      if (!isSettlementCategory(categoryId)) {
        totalAmount += expense.amount
      }
      const createdBy = expense.createdByParticipantId
        ? mappingBySource.get(expense.createdByParticipantId)?.mode ===
          'LINK_ACCOUNT'
          ? actor.accountId
          : null
        : null
      const documents = expense.documents.flatMap((document) => {
        const promoted = options.prepared.documents.get(document.sourceId)
        if (!promoted) return []
        importedDocuments += 1
        return [
          {
            id: randomId(),
            url: promoted.url,
            fileName: document.fileName,
            contentType: document.contentType,
            width: document.width,
            height: document.height,
            ledgerId: ledger.id,
          },
        ]
      })
      const sourceSeries = expense.recurringSeriesId
        ? sourceSeriesById.get(expense.recurringSeriesId)
        : undefined
      const expenseTimeZone =
        expense.expenseTimeZone ?? sourceSeries?.timeZone ?? 'UTC'
      const canonicalExpenseDate = expense.expenseDate.includes('T')
        ? asDate(expense.expenseDate)
        : sourceSeries
          ? wallTimeToUtc(
              expense.expenseDate,
              sourceSeries.anchorTimeMinutes ?? 900,
              expenseTimeZone,
            )
          : new Date(`${expense.expenseDate}T12:00:00.000Z`)
      await tx.expense.create({
        data: {
          id: expenseId,
          ledgerId: ledger.id,
          createdByAccountId: createdBy,
          expenseDate: toSecondPrecision(canonicalExpenseDate),
          expenseTimeZone,
          title: expense.title,
          categoryId,
          amount: expense.amount,
          originalAmount: expense.originalAmount,
          originalCurrency: expense.originalCurrency,
          conversionRate: expense.conversionRate,
          conversionSource: expense.conversionSource,
          paidBySplitMode: expense.paidBySplitMode,
          splitMode: expense.splitMode,
          version: expense.version,
          createdAt: asDate(expense.createdAt),
          notes: expense.notes,
          recurringSeriesId: expense.recurringSeriesId
            ? (seriesIds.get(expense.recurringSeriesId) ?? null)
            : null,
          recurrenceSequence: expense.recurrenceSequence,
          paidByList: {
            createMany: {
              data: mapRows(expense.paidByList, destinationIds),
            },
          },
          paidFor: {
            createMany: {
              data: mapRows(expense.paidFor, destinationIds),
            },
          },
          items: {
            create: expense.items.map((item) => ({
              id: randomId(),
              title: item.title,
              unitPrice: item.unitPrice,
              quantity: item.quantity,
              amount: item.amount,
              splitMode: item.splitMode,
              notes: item.notes ?? null,
              createdAt: item.createdAt
                ? asDate(item.createdAt)
                : asDate(expense.createdAt),
              paidFor: {
                createMany: {
                  data: mapRows(item.paidFor, destinationIds),
                },
              },
            })),
          },
          ...(expense.itemizedRemainder
            ? {
                itemizedRemainder: {
                  create: {
                    splitMode: expense.itemizedRemainder.splitMode,
                    paidFor: {
                      createMany: {
                        data: mapRows(
                          expense.itemizedRemainder.paidFor,
                          destinationIds,
                        ),
                      },
                    },
                  },
                },
              }
            : {}),
          documents: { create: documents },
          comments: {
            create: expense.comments.map((comment) => ({
              id: randomId(),
              authorAccountId:
                comment.authorParticipantId &&
                mappingBySource.get(comment.authorParticipantId)?.mode ===
                  'LINK_ACCOUNT'
                  ? actor.accountId
                  : null,
              authorName: comment.authorName,
              text: comment.text,
              createdAt: asDate(comment.createdAt),
            })),
          },
        },
      })
    }

    for (const document of manifest.orphanDocuments) {
      const promoted = options.prepared.documents.get(document.sourceId)
      if (!promoted) continue
      importedDocuments += 1
      await tx.expenseDocument.create({
        data: {
          id: randomId(),
          url: promoted.url,
          fileName: document.fileName,
          contentType: document.contentType,
          width: document.width,
          height: document.height,
          ledgerId: ledger.id,
        },
      })
    }

    for (const subgroup of manifest.subgroups) {
      await tx.subgroup.create({
        data: {
          id: randomId(),
          groupId: group.id,
          name: subgroup.name,
          createdAt: asDate(subgroup.createdAt),
          updatedAt: asDate(subgroup.updatedAt),
          members: {
            create: subgroup.participantIds.map((sourceId) => ({
              ledgerParticipantId: destinationIds.get(sourceId)!,
            })),
          },
        },
      })
    }
    for (const budget of manifest.budgets) {
      await tx.groupBudget.create({
        data: {
          id: randomId(),
          groupId: group.id,
          ledgerId: ledger.id,
          name: budget.name,
          amount: budget.amount,
          period: budget.period,
          timeZone: budget.timeZone,
          customStartDate: budget.customStartDate
            ? dateOnly(budget.customStartDate)
            : null,
          customEndDate: budget.customEndDate
            ? dateOnly(budget.customEndDate)
            : null,
          categoryScope: budget.categoryScope,
          categoryNodeIds: budget.categoryNodeIds,
          participantScope: budget.participantScope,
          participantIds: budget.participantIds.map((id) =>
            destinationIds.get(id)!,
          ),
          notifyTrending: budget.notifyTrending,
          notifyOver: budget.notifyOver,
          archived: budget.archived,
          archivedAt: budget.archivedAt ? asDate(budget.archivedAt) : null,
          createdByAccountId: actor.accountId,
          createdAt: asDate(budget.createdAt),
          updatedAt: asDate(budget.updatedAt),
        },
      })
    }
    const invites: CloudImportResult['invites'] = [...friendInvites]
    for (const participant of manifest.participants) {
      if (isFriendLedger) break
      const mapping = mappingBySource.get(participant.sourceId)!
      if (
        mapping.mode !== 'INVITE_BY_EMAIL' &&
        mapping.mode !== 'INVITE_CONTACT' &&
        mapping.mode !== 'INVITE_BY_LINK'
      ) {
        continue
      }
      const ledgerParticipantId = destinationIds.get(participant.sourceId)!
      if (
        mapping.mode === 'INVITE_BY_EMAIL' ||
        mapping.mode === 'INVITE_CONTACT'
      ) {
        const invitation = await tx.groupInvitation.create({
          data: {
            id: randomId(),
            groupId: group.id,
            type: 'EMAIL',
            email: mapping.email!.trim().toLowerCase(),
            temporaryName: participant.displayName,
            role: 'MEMBER',
            invitedById: actor.accountId,
            ledgerParticipantId,
          },
        })
        invites.push({
          sourceName: participant.displayName,
          kind: 'EMAIL',
          invitationId: invitation.id,
          email: invitation.email,
        })
      } else {
        const token = randomId()
        await assertInvitationRouteIdDoesNotMatchGroup(token, tx)
        const invitation = await tx.groupInvitation.create({
          data: {
            id: randomId(),
            groupId: group.id,
            type: 'LINK',
            email: buildLinkPlaceholderEmail(token),
            temporaryName: participant.displayName,
            role: 'MEMBER',
            invitedById: actor.accountId,
            ledgerParticipantId,
            tokenHash: await hashLinkToken(token),
            expiresAt: new Date(Date.now() + LINK_INVITATION_DEFAULT_TTL_MS),
          },
        })
        invites.push({
          sourceName: participant.displayName,
          kind: 'LINK',
          invitationId: invitation.id,
          inviteUrl: `${getWebBaseUrl()}/groups/${token}`,
        })
      }
    }
    if (input.groupPreference) {
      await tx.accountGroupPreference.upsert({
        where: {
          accountId_groupId: {
            accountId: actor.accountId,
            groupId: group.id,
          },
        },
        create: {
          id: randomId(),
          accountId: actor.accountId,
          groupId: group.id,
          starred: input.groupPreference.starred,
          hidden: input.groupPreference.hidden,
        },
        update: {
          starred: input.groupPreference.starred,
          hidden: input.groupPreference.hidden,
        },
      })
      if (input.groupPreference.defaultSplit) {
        const header = await tx.accountGroupDefaultSplit.upsert({
          where: {
            accountId_groupId: {
              accountId: actor.accountId,
              groupId: group.id,
            },
          },
          create: {
            id: randomId(),
            accountId: actor.accountId,
            groupId: group.id,
            splitMode: input.groupPreference.defaultSplit.splitMode,
          },
          update: {
            splitMode: input.groupPreference.defaultSplit.splitMode,
            updatedAt: new Date(),
          },
        })
        await tx.accountGroupDefaultSplitPaidFor.deleteMany({
          where: { defaultSplitId: header.id },
        })
        await tx.accountGroupDefaultSplitPaidFor.createMany({
          data: input.groupPreference.defaultSplit.paidFor.map((row) => ({
            defaultSplitId: header.id,
            participantId: destinationIds.get(row.participantId)!,
            shares: row.shares,
          })),
        })
      }
    }
    if (input.archived) {
      await tx.group.update({
        where: { id: group.id },
        data: { archived: true },
      })
    }
    const summaryActivity = await logActivity(
      group.id,
      {
        type: 'EXPENSES_IMPORTED',
        actor: { type: 'ACCOUNT', id: actor.accountId },
        subject: { type: 'GROUP', id: group.id },
        data: buildImportSummaryActivityData({
          summary: 'Imported from Spliit Cloud',
          count: manifest.expenses.length,
          totalAmount,
          currencyCode: ledger.currencyCode,
          sourceProvider: 'spliit.cloud',
        }),
      },
      tx,
      ledger.id,
    )
    void summaryActivity
    return {
      groupId: group.id,
      ledgerId: ledger.id,
      importedDocuments,
      destinationIds,
      invites,
    }
  }

  const result = options.tx
    ? await run(options.tx)
    : await prisma.$transaction(run)
  return {
    groupId: result.groupId,
    ledgerId: result.ledgerId,
    importedExpenses: manifest.expenses.length,
    importedDocuments: result.importedDocuments,
    sourceGroupId: manifest.group.sourceId,
    invites: result.invites,
    promotedDocumentUrls: options.prepared.promotedDocumentUrls,
  }
}
