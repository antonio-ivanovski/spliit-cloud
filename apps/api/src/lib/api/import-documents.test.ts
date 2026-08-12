// organize-imports-ignore: test mocks and upload mocks must be registered
// before importing the preparation module.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { prismaMock } from '../../test/state'
import { sealStagedDocumentClaims } from '../import-documents'

const uploadMocks = vi.hoisted(() => ({
  deleteS3Object: vi.fn(),
  permanentDocumentUrl: vi.fn((url: string) =>
    url.replace('/tmp/', '/documents/'),
  ),
  verifyAndPromoteImportDocument: vi.fn(),
}))

vi.mock('../../routes/upload', () => uploadMocks)
vi.mock('./boss', () => ({ getApiBoss: vi.fn().mockResolvedValue(null) }))

import { prepareImportGroup, type ImportInput } from './import'

const sessionId = '00000000-0000-4000-8000-000000000001'
const permanentUrl =
  'https://uploads.example.com/documents/imports/account-1/session/doc.jpg'
const temporaryUrl =
  'https://uploads.example.com/tmp/imports/account-1/session/doc.jpg'

const expense = {
  expenseDate: new Date('2025-11-15T00:00:00.000Z'),
  expenseTimeZone: 'UTC',
  title: 'Dinner',
  category: 'food',
  amount: 1000,
  paidBySplitMode: 'BY_AMOUNT' as const,
  paidByList: [{ participant: 'dest-1', shares: 1000 }],
  paidFor: [{ participant: 'dest-1', shares: 1000 }],
  splitMode: 'BY_AMOUNT' as const,
  isReimbursement: false,
  documents: [],
  recurrenceRule: 'NONE' as const,
}

async function input(targetGroupId?: string): Promise<ImportInput> {
  const stagedToken = await sealStagedDocumentClaims({
    aud: 'spliit:import-staged-document',
    accountId: 'account-1',
    sessionId,
    expenseIndex: 0,
    sourceDocumentId: 'source-doc-1',
    key: 'tmp/imports/account-1/session/doc.jpg',
    fileUrl: temporaryUrl,
    fileSize: 100,
    width: 640,
    height: 480,
  })
  return {
    targetGroupId,
    groupFormValues: targetGroupId
      ? undefined
      : {
          name: 'Imported group',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
        },
    participants: [],
    expenses: [expense],
    documentImport: { sessionId, stagedTokens: [stagedToken] },
  }
}

describe('prepareImportGroup document staging', () => {
  beforeEach(() => {
    uploadMocks.deleteS3Object.mockReset()
    uploadMocks.verifyAndPromoteImportDocument.mockReset()
    uploadMocks.verifyAndPromoteImportDocument.mockResolvedValue({
      expenseIndex: 0,
      sourceDocumentId: 'source-doc-1',
      url: permanentUrl,
      temporaryUrl,
      width: 640,
      height: 480,
    })
  })

  it('associates a promoted document with its imported expense', async () => {
    const prepared = await prepareImportGroup(await input(), {
      accountId: 'account-1',
    })

    expect(prepared.preparedExpenses[0].documents).toHaveLength(1)
    expect(prepared.preparedExpenses[0].documents[0].document).toEqual({
      url: permanentUrl,
      width: 640,
      height: 480,
    })
    expect(prepared.stagedDocumentUrls).toEqual([temporaryUrl])
  })

  it('does not promote documents when a later preflight check fails', async () => {
    prismaMock.group.findUnique.mockResolvedValueOnce(null)

    await expect(
      prepareImportGroup(await input('missing-group'), {
        accountId: 'account-1',
      }),
    ).rejects.toThrow('Target group not found')

    expect(uploadMocks.verifyAndPromoteImportDocument).not.toHaveBeenCalled()
    expect(uploadMocks.deleteS3Object).not.toHaveBeenCalled()
  })

  it('compensates permanent copies when a promotion batch partially fails', async () => {
    const importInput = await input()
    const secondToken = await sealStagedDocumentClaims({
      aud: 'spliit:import-staged-document',
      accountId: 'account-1',
      sessionId,
      expenseIndex: 0,
      sourceDocumentId: 'source-doc-2',
      key: 'tmp/imports/account-1/session/doc-2.jpg',
      fileUrl:
        'https://uploads.example.com/tmp/imports/account-1/session/doc-2.jpg',
      fileSize: 100,
      width: 640,
      height: 480,
    })
    importInput.documentImport!.stagedTokens.push(secondToken)
    uploadMocks.verifyAndPromoteImportDocument
      .mockResolvedValueOnce({
        expenseIndex: 0,
        sourceDocumentId: 'source-doc-1',
        url: permanentUrl,
        temporaryUrl,
        width: 640,
        height: 480,
      })
      .mockRejectedValueOnce(new Error('promotion failed'))

    await expect(
      prepareImportGroup(importInput, { accountId: 'account-1' }),
    ).rejects.toThrow('promotion failed')

    expect(uploadMocks.deleteS3Object).toHaveBeenCalledOnce()
    expect(uploadMocks.deleteS3Object).toHaveBeenCalledWith(permanentUrl)
    expect(uploadMocks.deleteS3Object).not.toHaveBeenCalledWith(temporaryUrl)
  })
})
