import { describe, expect, it } from 'vitest'
import { AppError } from '../errors.js'
import { parseUploadFields, translateMultipartError } from './multipart.js'

describe('translateMultipartError', () => {
  it.each([
    ['FST_REQ_FILE_TOO_LARGE', 413, 'photo_too_large'],
    ['FST_FILES_LIMIT', 400, 'too_many_files'],
    ['FST_FIELDS_LIMIT', 400, 'too_many_fields'],
    ['FST_PARTS_LIMIT', 400, 'too_many_fields'],
  ])('turns %s into %i %s', (code, status, appCode) => {
    const result = translateMultipartError(
      Object.assign(new Error('internal text'), { code }),
    )

    expect(result).toBeInstanceOf(AppError)
    expect(result).toMatchObject({ statusCode: status, code: appCode })
  })

  it('passes an application error through unchanged', () => {
    const original = new AppError(400, 'unknown_field', 'nope')

    expect(translateMultipartError(original)).toBe(original)
  })

  it.each([
    [
      'another library error',
      Object.assign(new Error('secret detail'), { code: 'SOMETHING_ELSE' }),
    ],
    ['an error without a code', new Error('secret detail')],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
  ])('turns %s into a 400 that reveals nothing', (_name, error) => {
    const result = translateMultipartError(error)

    expect(result).toMatchObject({ statusCode: 400, code: 'bad_upload' })
    expect(result.message).not.toContain('secret')
  })
})

function failure(fields: Array<[string, string]>): AppError {
  try {
    parseUploadFields(new Map(fields))
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected the fields to be refused')
}

describe('parseUploadFields: accepted', () => {
  it('accepts no fields at all', () => {
    expect(parseUploadFields(new Map())).toEqual({
      caption: undefined,
      manualTime: undefined,
    })
  })

  it.each([
    ['trims spaces', ' Cold one ', 'Cold one'],
    ['keeps line breaks inside', 'line one\nline two', 'line one\nline two'],
    ['turns spaces only into nothing', '   ', undefined],
    ['turns an empty caption into nothing', '', undefined],
    ['accepts exactly 140 characters', 'a'.repeat(140), 'a'.repeat(140)],
    [
      'counts an emoji as one character',
      '\u{1F37A}'.repeat(140),
      '\u{1F37A}'.repeat(140),
    ],
  ])('%s', (_name, caption, expected) => {
    expect(parseUploadFields(new Map([['caption', caption]])).caption).toBe(
      expected,
    )
  })

  it.each([
    ['a time in UTC', '2026-01-15T09:42:10Z', '2026-01-15T09:42:10.000Z'],
    [
      'a time behind UTC',
      '2026-01-15T09:42:10-05:00',
      '2026-01-15T14:42:10.000Z',
    ],
    [
      'a time ahead of UTC',
      '2026-01-15T22:30:00+09:00',
      '2026-01-15T13:30:00.000Z',
    ],
    [
      'a time with milliseconds',
      '2026-01-15T09:42:10.123Z',
      '2026-01-15T09:42:10.123Z',
    ],
  ])('reads %s', (_name, text, iso) => {
    expect(
      parseUploadFields(
        new Map([['manualTime', text]]),
      ).manualTime?.toISOString(),
    ).toBe(iso)
  })
})

describe('parseUploadFields: refused', () => {
  it.each([
    ['a caption of 141 characters', [['caption', 'a'.repeat(141)]]],
    ['a caption of 141 emoji', [['caption', '\u{1F37A}'.repeat(141)]]],
    ['a caption with a NUL character', [['caption', 'bad\u0000caption']]],
    ['a date with no time', [['manualTime', '2026-01-15']]],
    ['a time with no offset', [['manualTime', '2026-01-15T09:42:10']]],
    [
      'a time with a space instead of T',
      [['manualTime', '2026-01-15 09:42:10Z']],
    ],
    ['an offset without a colon', [['manualTime', '2026-01-15T09:42:10+0900']]],
    ['words', [['manualTime', 'yesterday']]],
    ['a number of seconds', [['manualTime', '1736934130']]],
    ['an empty time', [['manualTime', '']]],
    ['a day that does not exist', [['manualTime', '2026-02-30T00:00:00Z']]],
    ['a month that does not exist', [['manualTime', '2026-13-01T00:00:00Z']]],
    ['a leap second', [['manualTime', '2026-01-15T23:59:60Z']]],
    ['a field it does not know', [['sneaky', 'value']]],
    [
      'a known field next to an unknown one',
      [
        ['caption', 'ok'],
        ['sneaky', 'value'],
      ],
    ],
  ] as Array<[string, Array<[string, string]>]>)(
    'refuses %s',
    (_name, fields) => {
      const error = failure(fields)

      expect(error).toMatchObject({ statusCode: 400, code: 'validation_error' })
      expect(Array.isArray(error.details)).toBe(true)
    },
  )

  it('says which field was wrong', () => {
    const error = failure([['manualTime', 'yesterday']])

    expect(JSON.stringify(error.details)).toContain('manualTime')
  })
})
