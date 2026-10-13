import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  deletePendingShare,
  extractPendingShareInput,
  getPendingShare,
  hasPendingShareContent,
  putPendingShare,
  SHARE_TARGET_DB_NAME,
  SHARE_TARGET_MAX_FILES,
  SHARE_TARGET_MAX_TEXT_LENGTH,
} from './share-target-store'

// Authoring gate (test-audit): this file owns the SW↔page staging contract —
// IDB round-trip with Blobs, expiry, and share-target form parsing. Service
// worker redirect behavior is owned by sw.test.ts; page rendering by the page.

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SHARE_TARGET_DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('delete blocked'))
  })
}

beforeEach(async () => {
  await deleteDatabase()
})

describe('pending share staging', () => {
  it('round-trips files and text through IndexedDB', async () => {
    const blob = new Blob(['receipt-bytes'], { type: 'image/jpeg' })
    const id = await putPendingShare({
      title: 'Lidl',
      text: 'weekly shop',
      url: null,
      files: [
        { name: 'receipt.jpg', type: 'image/jpeg', size: blob.size, blob },
      ],
    })

    const entry = await getPendingShare(id)
    expect(entry?.title).toBe('Lidl')
    expect(entry?.text).toBe('weekly shop')
    expect(entry?.files).toHaveLength(1)
    expect(entry?.files[0]?.name).toBe('receipt.jpg')
    expect(await entry?.files[0]?.blob.text()).toBe('receipt-bytes')
  })

  it('returns null for unknown ids', async () => {
    await expect(getPendingShare('missing')).resolves.toBeNull()
  })

  it('drops expired shares instead of resurrecting them', async () => {
    const id = await putPendingShare({
      createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      files: [],
      text: 'stale',
    })

    await expect(getPendingShare(id)).resolves.toBeNull()
    // Second read stays missing: the expired entry was deleted, not kept.
    await expect(getPendingShare(id)).resolves.toBeNull()
  })

  it('deletes shares on demand', async () => {
    const id = await putPendingShare({ text: 'note' })
    await deletePendingShare(id)
    await expect(getPendingShare(id)).resolves.toBeNull()
  })
})

describe('extractPendingShareInput', () => {
  it('maps title, text, url and files from the share POST body', () => {
    const formData = new FormData()
    formData.set('title', 'Lidl')
    formData.set('text', 'https://shop.example/receipt/1')
    formData.append(
      'receipts',
      new File(['bytes'], 'receipt.jpg', { type: 'image/jpeg' }),
    )

    const input = extractPendingShareInput(formData)
    expect(input.title).toBe('Lidl')
    expect(input.text).toBe('https://shop.example/receipt/1')
    expect(input.files).toHaveLength(1)
    expect(input.files[0]).toMatchObject({
      name: 'receipt.jpg',
      type: 'image/jpeg',
      size: 5,
    })
    expect(hasPendingShareContent(input)).toBe(true)
  })

  it('skips empty files and caps the file count', () => {
    const formData = new FormData()
    formData.append(
      'receipts',
      new File([], 'empty.jpg', { type: 'image/jpeg' }),
    )
    for (let i = 0; i < SHARE_TARGET_MAX_FILES + 4; i += 1) {
      formData.append(
        'receipts',
        new File(['x'], `r${i}.jpg`, { type: 'image/jpeg' }),
      )
    }

    const input = extractPendingShareInput(formData)
    expect(input.files).toHaveLength(SHARE_TARGET_MAX_FILES)
    expect(input.files.every((file) => file.size > 0)).toBe(true)
  })

  it('truncates runaway text instead of bloating the store', () => {
    const formData = new FormData()
    formData.set('text', `x${'y'.repeat(SHARE_TARGET_MAX_TEXT_LENGTH + 100)}`)

    const input = extractPendingShareInput(formData)
    expect(input.text?.length).toBe(SHARE_TARGET_MAX_TEXT_LENGTH)
  })

  it('reports contentless shares as empty', () => {
    expect(
      hasPendingShareContent({
        title: null,
        text: null,
        url: null,
        files: [],
      }),
    ).toBe(false)
    expect(
      hasPendingShareContent({
        title: null,
        text: 'note',
        url: null,
        files: [],
      }),
    ).toBe(true)
  })

  it('trims whitespace-only fields to null', () => {
    const formData = new FormData()
    formData.set('title', '   ')
    formData.set('text', '')

    const input = extractPendingShareInput(formData)
    expect(input.title).toBeNull()
    expect(input.text).toBeNull()
    expect(hasPendingShareContent(input)).toBe(false)
  })
})
