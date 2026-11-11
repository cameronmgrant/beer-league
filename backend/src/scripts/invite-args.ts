import { parseArgs } from 'node:util'

export function parseInviteArgs(args: string[]): {
  count: number
  days: number
} {
  const { values } = parseArgs({
    args,
    options: { count: { type: 'string' }, days: { type: 'string' } },
    strict: true,
  })

  return {
    count: values.count === undefined ? 1 : Number(values.count),
    days: values.days === undefined ? 14 : Number(values.days),
  }
}
