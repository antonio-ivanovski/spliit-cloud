import { spliitCloudProvider } from './spliit-cloud'

jest.mock('../../prisma', () => ({
  prisma: {
    syncedGroup: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
  },
}))

const prismaMock = jest.requireMock('../../prisma').prisma as {
  syncedGroup: {
    deleteMany: jest.Mock
    createMany: jest.Mock
    findMany: jest.Mock
  }
}

describe('spliitCloudProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('push replaces all user groups', async () => {
    const groups = [
      {
        groupId: 'group-1',
        groupName: 'Alpha',
        addedAt: new Date('2025-01-01T00:00:00.000Z'),
      },
    ]

    await spliitCloudProvider.push('user-1', groups)

    expect(prismaMock.syncedGroup.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    })
    expect(prismaMock.syncedGroup.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'user-1',
          groupId: 'group-1',
          groupName: 'Alpha',
          addedAt: groups[0].addedAt,
        },
      ],
    })
  })

  it('pull returns all user groups', async () => {
    prismaMock.syncedGroup.findMany.mockResolvedValue([
      {
        groupId: 'group-1',
        groupName: 'Alpha',
        addedAt: new Date('2025-01-01T00:00:00.000Z'),
      },
      {
        groupId: 'group-2',
        groupName: 'Beta',
        addedAt: new Date('2025-01-02T00:00:00.000Z'),
      },
    ])

    await expect(spliitCloudProvider.pull('user-1')).resolves.toEqual([
      {
        groupId: 'group-1',
        groupName: 'Alpha',
        addedAt: new Date('2025-01-01T00:00:00.000Z'),
      },
      {
        groupId: 'group-2',
        groupName: 'Beta',
        addedAt: new Date('2025-01-02T00:00:00.000Z'),
      },
    ])
    expect(prismaMock.syncedGroup.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { addedAt: 'desc' },
    })
  })

  it('sync merges local and remote groups', async () => {
    prismaMock.syncedGroup.findMany.mockResolvedValue([
      {
        groupId: 'group-1',
        groupName: 'Remote Name',
        addedAt: new Date('2025-01-01T00:00:00.000Z'),
      },
    ])

    const localGroups = [
      {
        groupId: 'group-2',
        groupName: 'Local Group',
        addedAt: new Date('2025-01-03T00:00:00.000Z'),
      },
    ]

    const merged = await spliitCloudProvider.sync('user-1', localGroups)

    expect(merged).toHaveLength(2)
    expect(merged).toEqual(
      expect.arrayContaining([
        {
          groupId: 'group-1',
          groupName: 'Remote Name',
          addedAt: new Date('2025-01-01T00:00:00.000Z'),
        },
        {
          groupId: 'group-2',
          groupName: 'Local Group',
          addedAt: new Date('2025-01-03T00:00:00.000Z'),
        },
      ]),
    )
  })

  it('sync uses earliest addedAt for duplicates', async () => {
    prismaMock.syncedGroup.findMany.mockResolvedValue([
      {
        groupId: 'group-1',
        groupName: 'Remote',
        addedAt: new Date('2025-01-01T00:00:00.000Z'),
      },
    ])

    const localGroups = [
      {
        groupId: 'group-1',
        groupName: 'Local',
        addedAt: new Date('2025-01-05T00:00:00.000Z'),
      },
    ]

    const merged = await spliitCloudProvider.sync('user-1', localGroups)

    expect(merged).toEqual([
      {
        groupId: 'group-1',
        groupName: 'Local',
        addedAt: new Date('2025-01-01T00:00:00.000Z'),
      },
    ])
  })

  it('sync handles empty local groups', async () => {
    prismaMock.syncedGroup.findMany.mockResolvedValue([
      {
        groupId: 'group-1',
        groupName: 'Remote',
        addedAt: new Date('2025-01-01T00:00:00.000Z'),
      },
    ])

    const merged = await spliitCloudProvider.sync('user-1', [])

    expect(merged).toEqual([
      {
        groupId: 'group-1',
        groupName: 'Remote',
        addedAt: new Date('2025-01-01T00:00:00.000Z'),
      },
    ])
  })

  it('sync handles empty remote groups', async () => {
    prismaMock.syncedGroup.findMany.mockResolvedValue([])

    const localGroups = [
      {
        groupId: 'group-2',
        groupName: 'Local',
        addedAt: new Date('2025-01-04T00:00:00.000Z'),
      },
    ]

    const merged = await spliitCloudProvider.sync('user-1', localGroups)

    expect(merged).toEqual(localGroups)
  })
})
