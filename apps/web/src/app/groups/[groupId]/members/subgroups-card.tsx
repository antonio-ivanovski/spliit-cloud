import {
  AlertTriangle,
  Check,
  Edit3,
  Layers3,
  Plus,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AvatarStack } from '@/components/avatar-stack'
import { useMascotController } from '@/components/mascot/mascot-context'
import { ParticipantAvatar } from '@/components/participant-avatar'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'
import { useIdempotentCreate } from '@/lib/use-idempotent-create'
import { trpc } from '@/trpc/client'

import { useGroupAccessSearch } from '../use-group-access-search'

type Participant = {
  id: string
  name: string
  account?: { id: string; name?: string | null; image?: string | null } | null
  pending: boolean
  unlinked: boolean
}

type EditState = {
  subgroupId: string | null
  name: string
  participantIds: string[]
}

export function SubgroupsCard({
  groupId,
  participants,
  canManage,
}: {
  groupId: string
  participants: Participant[]
  canManage: boolean
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const { toast } = useToast()
  const mascot = useMascotController()
  const utils = trpc.useUtils()
  const { linkInviteToken, viewKey } = useGroupAccessSearch()
  const subgroupsQuery = trpc.groups.subgroups.list.useQuery({
    groupId,
    linkInviteToken,
    viewKey,
  })
  const [editor, setEditor] = useState<EditState | null>(null)
  const [disableDialogOpen, setDisableDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{
    subgroupId: string
    name: string
  } | null>(null)
  const eligibleParticipants = useMemo(() => participants, [participants])
  const subgroupData = subgroupsQuery.data

  const refresh = async () => {
    await Promise.all([
      utils.groups.subgroups.list.invalidate({
        groupId,
        linkInviteToken,
        viewKey,
      }),
      utils.groups.get.invalidate({ groupId }),
      utils.groups.balances.list.invalidate({ groupId }),
    ])
  }

  const enabledMutation = trpc.groups.subgroups.setEnabled.useMutation({
    onSuccess: async () => {
      setEditor(null)
      setDisableDialogOpen(false)
      await refresh()
    },
    onError: (error) =>
      toast({ description: error.message, variant: 'destructive' }),
  })
  const createMutation = trpc.groups.subgroups.create.useMutation({
    onSuccess: async () => {
      setEditor(null)
      await refresh()
    },
    onError: (error) =>
      toast({ description: error.message, variant: 'destructive' }),
  })
  const createAttempt = useIdempotentCreate()
  const updateMutation = trpc.groups.subgroups.update.useMutation({
    onSuccess: async () => {
      setEditor(null)
      await refresh()
    },
    onError: (error) =>
      toast({ description: error.message, variant: 'destructive' }),
  })
  const deleteMutation = trpc.groups.subgroups.delete.useMutation({
    onSuccess: async () => {
      mascot.react('acknowledge')
      setDeleteTarget(null)
      await refresh()
    },
    onError: (error) =>
      toast({ description: error.message, variant: 'destructive' }),
  })

  if (subgroupsQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('subgroups.title')}</CardTitle>
          <CardDescription role="alert">
            {t('subgroups.loadError')}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (subgroupsQuery.isLoading || !subgroupData) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
      </Card>
    )
  }

  const assignedByParticipant = new Map<string, string>()
  for (const subgroup of subgroupData.subgroups) {
    for (const participantId of subgroup.participantIds) {
      assignedByParticipant.set(participantId, subgroup.name)
    }
  }
  const assignedParticipantIds = new Set(assignedByParticipant.keys())
  const ungroupedParticipants = eligibleParticipants.filter(
    (participant) => !assignedParticipantIds.has(participant.id),
  )

  const startCreate = () =>
    setEditor({ subgroupId: null, name: '', participantIds: [] })
  const startEdit = (subgroupId: string) => {
    const subgroup = subgroupData.subgroups.find(({ id }) => id === subgroupId)
    if (!subgroup) return
    setEditor({
      subgroupId,
      name: subgroup.name,
      participantIds: subgroup.participantIds,
    })
  }
  const submitEditor = () => {
    if (
      !editor ||
      editor.name.trim().length === 0 ||
      editor.participantIds.length < 2
    ) {
      toast({
        description: t('subgroups.validation'),
        variant: 'destructive',
      })
      return
    }
    const payload = {
      groupId,
      name: editor.name.trim(),
      participantIds: editor.participantIds,
    }
    if (editor.subgroupId) {
      updateMutation.mutate({ ...payload, subgroupId: editor.subgroupId })
    } else {
      void createAttempt
        .run((requestId) =>
          createMutation.mutateAsync({ ...payload, requestId }),
        )
        .catch(() => {
          // The mutation's onError callback owns the user-facing failure toast.
        })
    }
  }
  const isSaving = createMutation.isPending || updateMutation.isPending

  const toggleEnabled = (checked: boolean) => {
    if (!checked && subgroupData.subgroups.length > 0) {
      setDisableDialogOpen(true)
      return
    }
    enabledMutation.mutate({ groupId, enabled: checked })
  }

  const confirmDisable = () => {
    enabledMutation.mutate({ groupId, enabled: false })
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    deleteMutation.mutate({
      groupId,
      subgroupId: deleteTarget.subgroupId,
    })
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/60 bg-muted/10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Layers3 className="size-4" aria-hidden="true" />
              </span>
              <CardTitle>{t('subgroups.title')}</CardTitle>
            </div>
            <CardDescription className="mt-2 max-w-2xl">
              {t('subgroups.description')}
            </CardDescription>
          </div>
          <Switch
            checked={subgroupData.enabled}
            disabled={!canManage || enabledMutation.isPending}
            onCheckedChange={toggleEnabled}
            aria-label={
              subgroupData.enabled
                ? t('subgroups.disableAria')
                : t('subgroups.enableAria')
            }
          />
        </div>
      </CardHeader>

      {subgroupData.enabled && (
        <CardContent className="space-y-4 pt-5">
          {subgroupData.subgroups.length === 0 && !editor && (
            <div className="rounded-2xl border border-dashed border-border/80 px-4 py-6 text-center">
              <p className="text-sm font-medium">{t('subgroups.emptyTitle')}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('subgroups.emptyDescription')}
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {subgroupData.subgroups.map((subgroup) => {
              const members = subgroup.participantIds
                .map((participantId) =>
                  participants.find(({ id }) => id === participantId),
                )
                .filter((participant): participant is Participant =>
                  Boolean(participant),
                )
              return (
                <article
                  key={subgroup.id}
                  className="rounded-2xl border border-border/70 bg-background p-4 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <AvatarStack
                        accounts={members.map(
                          (member) =>
                            member.account ?? {
                              id: member.id,
                              name: member.name,
                            },
                        )}
                        size="md"
                        label={subgroup.name}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {subgroup.name}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {members.map(({ name }) => name).join(' · ')}
                        </p>
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => startEdit(subgroup.id)}
                          aria-label={t('subgroups.editAria', {
                            name: subgroup.name,
                          })}
                        >
                          <Edit3 className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={() =>
                            setDeleteTarget({
                              subgroupId: subgroup.id,
                              name: subgroup.name,
                            })
                          }
                          aria-label={t('subgroups.deleteAria', {
                            name: subgroup.name,
                          })}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>

          {ungroupedParticipants.length > 0 && (
            <section className="space-y-3 border-t border-border/60 pt-5">
              <div>
                <p className="text-sm font-medium">
                  {t('subgroups.ungroupedTitle')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('subgroups.ungroupedDescription')}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {ungroupedParticipants.map((participant) => (
                  <div
                    key={participant.id}
                    className="flex min-h-11 items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2"
                  >
                    <ParticipantAvatar participant={participant} size="sm" />
                    <span className="min-w-0 truncate text-sm">
                      {participant.name}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {canManage && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={startCreate}
            >
              <Plus className="me-2 size-4" aria-hidden="true" />
              {t('subgroups.create')}
            </Button>
          )}
        </CardContent>
      )}

      {editor && (
        <SubgroupEditorDialog
          editor={editor}
          participants={eligibleParticipants}
          assignedByParticipant={assignedByParticipant}
          isSaving={isSaving}
          onChange={setEditor}
          onCancel={() => setEditor(null)}
          onSave={submitEditor}
        />
      )}

      <ResponsiveDialog
        open={disableDialogOpen}
        onOpenChange={(open) => {
          if (!enabledMutation.isPending) setDisableDialogOpen(open)
        }}
      >
        <ResponsiveDialogContent className="max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t('subgroups.disableTitle')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t('subgroups.disableDescription')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <ResponsiveDialogBody>
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span>{t('subgroups.disableImpact')}</span>
            </div>
          </ResponsiveDialogBody>

          <ResponsiveDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-2">
            <Button
              variant="ghost"
              onClick={() => setDisableDialogOpen(false)}
              disabled={enabledMutation.isPending}
            >
              {t('subgroups.keep')}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDisable}
              disabled={enabledMutation.isPending}
            >
              {enabledMutation.isPending
                ? t('subgroups.disabling')
                : t('subgroups.disable')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setDeleteTarget(null)
        }}
      >
        <ResponsiveDialogContent className="max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t('subgroups.deleteTitle')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {deleteTarget
                ? t('subgroups.deleteDescription', { name: deleteTarget.name })
                : null}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <ResponsiveDialogBody>
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span>{t('subgroups.deleteImpact')}</span>
            </div>
          </ResponsiveDialogBody>

          <ResponsiveDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-2">
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteMutation.isPending}
            >
              {t('subgroups.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={!deleteTarget || deleteMutation.isPending}
            >
              {deleteMutation.isPending
                ? t('subgroups.deleting')
                : t('subgroups.delete')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </Card>
  )
}

function SubgroupEditorDialog({
  editor,
  participants,
  assignedByParticipant,
  isSaving,
  onChange,
  onCancel,
  onSave,
}: {
  editor: EditState
  participants: Participant[]
  assignedByParticipant: Map<string, string>
  isSaving: boolean
  onChange: (editor: EditState) => void
  onCancel: () => void
  onSave: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const toggleParticipant = (participantId: string, checked: boolean) => {
    onChange({
      ...editor,
      participantIds: checked
        ? [...editor.participantIds, participantId]
        : editor.participantIds.filter((id) => id !== participantId),
    })
  }

  const ungroupedParticipants = participants.filter(
    (participant) => !assignedByParticipant.has(participant.id),
  )
  const groupedParticipants = participants.filter((participant) =>
    assignedByParticipant.has(participant.id),
  )

  const renderParticipant = (participant: Participant) => {
    const assignedTo = assignedByParticipant.get(participant.id)
    const isSelected = editor.participantIds.includes(participant.id)
    const isDisabled = !!assignedTo && !isSelected
    return (
      <label
        key={participant.id}
        className={`flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 transition-colors ${isDisabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer hover:bg-muted/70'}`}
      >
        <Checkbox
          checked={isSelected}
          disabled={isDisabled}
          onCheckedChange={(checked) =>
            toggleParticipant(participant.id, checked === true)
          }
          aria-label={participant.name}
        />
        <ParticipantAvatar participant={participant} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm">
          {participant.name}
        </span>
        {assignedTo && !isSelected && (
          <span className="max-w-24 truncate text-[10px] text-muted-foreground">
            {t('subgroups.assignedTo', { name: assignedTo })}
          </span>
        )}
      </label>
    )
  }

  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => {
        if (!open && !isSaving) onCancel()
      }}
    >
      <ResponsiveDialogContent className="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {editor.subgroupId
              ? t('subgroups.editorEditTitle')
              : t('subgroups.editorCreateTitle')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('subgroups.editorDescription')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="space-y-4">
          <Input
            value={editor.name}
            onChange={(event) =>
              onChange({ ...editor, name: event.target.value })
            }
            placeholder={t('subgroups.namePlaceholder')}
            maxLength={120}
          />

          <div className="space-y-1">
            {ungroupedParticipants.length > 0 && (
              <section aria-label={t('subgroups.notInTitle')}>
                <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                  {t('subgroups.notInTitle')}
                </p>
                <div className="grid gap-1 sm:grid-cols-2">
                  {ungroupedParticipants.map(renderParticipant)}
                </div>
              </section>
            )}

            {groupedParticipants.length > 0 && (
              <section
                className={
                  ungroupedParticipants.length > 0
                    ? 'mt-3 border-t border-border/60 pt-3'
                    : undefined
                }
                aria-label={t('subgroups.inTitle')}
              >
                <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                  {t('subgroups.inTitle')}
                </p>
                <div className="grid gap-1 sm:grid-cols-2">
                  {groupedParticipants.map(renderParticipant)}
                </div>
              </section>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {t('subgroups.pickedCount', {
              count: editor.participantIds.length,
            })}
          </p>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isSaving}
          >
            {t('subgroups.cancel')}
          </Button>
          <Button type="button" onClick={onSave} disabled={isSaving}>
            {isSaving ? (
              t('subgroups.saving')
            ) : (
              <>
                <Check className="me-2 size-4" aria-hidden="true" />
                {t('subgroups.save')}
              </>
            )}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
