export type LinkCredential = { token: string; tokenHash: string }

/** Clock callback crosses the Prisma Promise boundary without losing TestClock. */
export type InvitationClock = { now: () => Date }
export type InvitationWriteContext = InvitationClock & {
  credential: LinkCredential
}
