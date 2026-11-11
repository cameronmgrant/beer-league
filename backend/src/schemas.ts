import { z } from 'zod/v4'

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

export const userSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  timeZone: z.string(),
})

export const userResponseSchema = z.object({ user: userSchema })
