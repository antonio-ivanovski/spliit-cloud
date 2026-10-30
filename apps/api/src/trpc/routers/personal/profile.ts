import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma } from '@spliit/db'
import { timeZoneSchema } from '@spliit/domain'
import { supportedCurrencyCodes } from '@spliit/domain/currency'

import {
  ensurePersonalProfile,
  personalHasData,
} from '../../../lib/personal/profile'
import { createTRPCRouter, protectedProcedure } from '../../init'
import { personalProfileSchema } from '../../outputs/personal'

const currencyCodeSchema = z
  .string()
  .refine(
    (code) => (supportedCurrencyCodes as readonly string[]).includes(code),
    'Unsupported currency',
  )

function profileDto(
  profile: {
    currencyCode: string
    timeZone: string
    sharedEnabled: boolean
  },
  hasData: boolean,
) {
  return {
    currencyCode: profile.currencyCode,
    timeZone: profile.timeZone,
    sharedEnabled: profile.sharedEnabled,
    hasData,
    canChangeCurrency: !hasData,
  }
}

export const personalProfileRouter = createTRPCRouter({
  get: protectedProcedure
    .output(personalProfileSchema)
    .query(async ({ ctx }) => {
      const accountId = ctx.auth.user.id
      const [profile, hasData] = await Promise.all([
        ensurePersonalProfile(accountId),
        personalHasData(accountId),
      ])
      return profileDto(profile, hasData)
    }),

  update: protectedProcedure
    .input(
      z.object({
        currencyCode: currencyCodeSchema.optional(),
        timeZone: timeZoneSchema.optional(),
        sharedEnabled: z.boolean().optional(),
      }),
    )
    .output(personalProfileSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = ctx.auth.user.id
      const profile = await ensurePersonalProfile(accountId)
      const hasData = await personalHasData(accountId)

      if (
        input.currencyCode &&
        input.currencyCode !== profile.currencyCode &&
        hasData
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'The personal currency cannot change while personal data exists',
        })
      }

      const updated = await prisma.personalProfile.update({
        where: { accountId },
        data: {
          ...(input.currencyCode ? { currencyCode: input.currencyCode } : {}),
          ...(input.timeZone ? { timeZone: input.timeZone } : {}),
          ...(input.sharedEnabled !== undefined
            ? { sharedEnabled: input.sharedEnabled }
            : {}),
        },
      })
      return profileDto(updated, hasData)
    }),
})
