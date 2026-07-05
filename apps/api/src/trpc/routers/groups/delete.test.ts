import { describe, expect, it } from 'vitest'
import '../../../test/mocks'
import { usePrismaMemoryStore } from '../../../test/prisma-memory-store'
import { authState, prismaMock } from '../../../test/state'
import { createTRPCContext } from '../../init'
import { groupsRouter } from './index'

function makeCaller(authUserId: string) {
  return groupsRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: authUserId,
        email: 'alice@example.com',
        emailVerified: true,
        name: 'Alice',
      },
    },
  } as never)
}

async function authAs(userId: string) {
  authState.session = {
    user: { id: userId },
    session: { id: 'sess-1' },
  }
  prismaMock.account.findUnique.mockImplementation(async (args: unknown) => {
    const id = (args as { where: { id: string } }).where.id
    return {
      id,
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
    }
  })
  return createTRPCContext({
    req: new Request('http://localhost/api/test'),
  })
}

function seedGroupContext(args: {
  callerRole: 'ADMIN' | 'MEMBER' | null
  archived?: boolean
}) {
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'grp-1',
    ledgerId: 'ledger-1',
    archived: args.archived ?? false,
    ledger: { id: 'ledger-1' },
  } as never)
  prismaMock.groupMember.findUnique.mockResolvedValue(
    args.callerRole
      ? ({
          id: 'gm-self',
          groupId: 'grp-1',
          accountId: 'acct-self',
          role: args.callerRole,
          status: 'ACTIVE',
        } as never)
      : null,
  )
}

describe('groupsRouter.delete', () => {
  it('deletes the group when the caller is an ADMIN', async () => {
    usePrismaMemoryStore({
      group: [
        { id: 'grp-1', name: 'Test', ledgerId: 'ledger-1', archived: false },
      ],
      ledger: [{ id: 'ledger-1', currency: '$', currencyCode: 'USD' }],
      groupMember: [
        {
          id: 'gm-self',
          groupId: 'grp-1',
          accountId: 'acct-self',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      ],
    })

    const caller = makeCaller('acct-self')
    const result = await caller.delete({ groupId: 'grp-1' })

    expect(result).toEqual({ deleted: true })
    expect(prismaMock.group.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'grp-1' } }),
    )
  })

  it('enumerates every expense document on the ledger before deleting the group', async () => {
    await authAs('acct-self')
    seedGroupContext({ callerRole: 'ADMIN' })
    prismaMock.expenseDocument.findMany.mockResolvedValue([] as never)

    const caller = makeCaller('acct-self')
    await caller.delete({ groupId: 'grp-1' })

    // The cleanup enumerates documents first so S3 cleanup (which isn't
    // mocked here) runs before the cascade; the cascade itself still
    // happens regardless of the document list length.
    expect(prismaMock.expenseDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ledgerId: 'ledger-1' } }),
    )
    expect(prismaMock.group.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'grp-1' } }),
    )
  })

  it('rejects a MEMBER caller with FORBIDDEN', async () => {
    await authAs('acct-self')
    seedGroupContext({ callerRole: 'MEMBER' })

    const caller = makeCaller('acct-self')
    await expect(caller.delete({ groupId: 'grp-1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(prismaMock.group.delete).not.toHaveBeenCalled()
  })

  it('rejects an archived group with FORBIDDEN', async () => {
    await authAs('acct-self')
    seedGroupContext({ callerRole: 'ADMIN', archived: true })

    const caller = makeCaller('acct-self')
    await expect(caller.delete({ groupId: 'grp-1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(prismaMock.group.delete).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller with UNAUTHORIZED', async () => {
    authState.session = null
    const ctx = await createTRPCContext({
      req: new Request('http://localhost/api/test'),
    })

    await expect(
      groupsRouter
        .createCaller({
          auth: ctx.auth,
        } as never)
        .delete({ groupId: 'grp-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('rejects a non-member caller with FORBIDDEN', async () => {
    await authAs('acct-outside')
    seedGroupContext({ callerRole: null })

    const caller = makeCaller('acct-outside')
    await expect(caller.delete({ groupId: 'grp-1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(prismaMock.group.delete).not.toHaveBeenCalled()
  })
})
