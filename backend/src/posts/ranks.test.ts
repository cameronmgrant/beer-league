import { describe, expect, it } from 'vitest'
import { assignRanks } from './ranks.js'

const rows = (...counts: number[]) =>
  counts.map((count, i) => ({ name: `user${i}`, count }))
const ranksOf = (counts: number[]) =>
  assignRanks(rows(...counts)).map((row) => row.rank)

describe('assignRanks', () => {
  it('numbers rows in order when nobody ties', () => {
    expect(ranksOf([5, 3, 1])).toEqual([1, 2, 3])
  })

  it('gives tied rows the same rank and skips the numbers after them', () => {
    expect(ranksOf([5, 3, 3, 1])).toEqual([1, 2, 2, 4])
  })

  it('handles a tie for first place', () => {
    expect(ranksOf([4, 4, 2])).toEqual([1, 1, 3])
  })

  it('ranks everyone 1 when all are tied', () => {
    expect(ranksOf([0, 0, 0])).toEqual([1, 1, 1])
  })

  it('handles one row and no rows', () => {
    expect(ranksOf([7])).toEqual([1])
    expect(ranksOf([])).toEqual([])
  })

  it('keeps the other fields and the order', () => {
    const ranked = assignRanks([
      { name: 'a', count: 2 },
      { name: 'b', count: 1 },
    ])
    expect(ranked).toEqual([
      { name: 'a', count: 2, rank: 1 },
      { name: 'b', count: 1, rank: 2 },
    ])
  })
})
