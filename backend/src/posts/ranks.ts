export function assignRanks<T extends { count: number }>(
  rows: T[],
): Array<T & { rank: number }> {
  let rank = 0
  let previousCount: number | undefined

  return rows.map((row, index) => {
    if (row.count !== previousCount) rank = index + 1
    previousCount = row.count
    return { ...row, rank }
  })
}
