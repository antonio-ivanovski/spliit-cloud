import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useIdempotentCreate } from './use-idempotent-create'

describe('useIdempotentCreate', () => {
  it('blocks synchronous double submissions and retains the id after failure', async () => {
    const ids = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]
    const randomUuid = vi
      .spyOn(crypto, 'randomUUID')
      .mockImplementation(
        () =>
          ids.shift() as `${string}-${string}-${string}-${string}-${string}`,
      )
    const { result } = renderHook(() => useIdempotentCreate())
    let rejectFirst!: (error: Error) => void
    const firstCreate = vi.fn(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectFirst = reject
        }),
    )

    const first = result.current.run(firstCreate)
    const firstFailure = expect(first).rejects.toThrow('lost response')
    const duplicate = result.current.run(firstCreate)
    expect(firstCreate).toHaveBeenCalledTimes(1)
    expect(await duplicate).toBeNull()
    await act(async () => rejectFirst(new Error('lost response')))
    await firstFailure

    const retry = vi.fn(async (requestId: string) => requestId)
    await expect(result.current.run(retry)).resolves.toBe(
      '00000000-0000-4000-8000-000000000001',
    )
    expect(randomUuid).toHaveBeenCalledTimes(2)
    randomUuid.mockRestore()
  })

  it('rotates the request id only after confirmed success', async () => {
    const ids = [
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000012',
      '00000000-0000-4000-8000-000000000013',
    ]
    const randomUuid = vi
      .spyOn(crypto, 'randomUUID')
      .mockImplementation(
        () =>
          ids.shift() as `${string}-${string}-${string}-${string}-${string}`,
      )
    const { result } = renderHook(() => useIdempotentCreate())
    const create = vi.fn(async (requestId: string) => requestId)

    await expect(result.current.run(create)).resolves.toBe(
      '00000000-0000-4000-8000-000000000011',
    )
    await expect(result.current.run(create)).resolves.toBe(
      '00000000-0000-4000-8000-000000000012',
    )
    randomUuid.mockRestore()
  })

  it('rotates the request id when the logical form is reset', async () => {
    const ids = [
      '00000000-0000-4000-8000-000000000021',
      '00000000-0000-4000-8000-000000000022',
      '00000000-0000-4000-8000-000000000023',
    ]
    const randomUuid = vi
      .spyOn(crypto, 'randomUUID')
      .mockImplementation(
        () =>
          ids.shift() as `${string}-${string}-${string}-${string}-${string}`,
      )
    const { result } = renderHook(() => useIdempotentCreate())
    act(() => result.current.reset())

    await expect(
      result.current.run(async (requestId) => requestId),
    ).resolves.toBe('00000000-0000-4000-8000-000000000022')
    randomUuid.mockRestore()
  })
})
