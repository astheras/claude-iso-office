import { expect, test } from 'claude-code/testing'

import type { ErrorCache, RawSession } from '../types'
import { errorLabel, errorOf, errorsScript, needsCheck, nextCache, parseErrors } from './errors'

const NOW = Date.parse('2026-11-13T12:00:00Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const s = (id: string, over: Partial<RawSession> = {}): RawSession => ({
  sessionId: id,
  title: id,
  isRunning: false,
  lastActivityAt: iso(60_000),
  ...over,
})

test('only a stopped chat that changed since it was read is read again', () => {
  const cache: ErrorCache = { seen: { at: iso(60_000) }, moved: { at: iso(999_000) } }
  const todo = needsCheck(
    [
      s('new'),
      s('seen'), // read at this very activity
      s('moved'), // active again since it was read
      s('running', { isRunning: true }),
      s('archived', { isArchived: true }),
      s('old', { lastActivityAt: iso(26 * 3600_000) }), // past the day: not listed, not read
    ],
    cache,
    NOW,
  )
  expect(todo.map(x => x.sessionId)).toEqual(['new', 'moved'])
})

test('no more than 30 chats are read in one run', () => {
  const many = Array.from({ length: 45 }, (_, i) => s(`c${i}`))
  expect(needsCheck(many, {}, NOW).length).toBe(30)
})

test('what was read replaces the old entries, and chats that left the list are forgotten', () => {
  const cache: ErrorCache = { gone: { at: 'x' }, kept: { at: 'k' }, redo: { at: 'old' } }
  const err = { code: 'server_error', text: 't', at: 1 }
  const raw = [s('kept'), s('redo', { lastActivityAt: 'now' }), s('fresh', { lastActivityAt: 'f' })]
  const next = nextCache(cache, raw, [raw[1]!, raw[2]!], { redo: err })
  expect(next).toEqual({ kept: { at: 'k' }, redo: { at: 'now', error: err }, fresh: { at: 'f' } })
})

test('an error is shown only while the chat is at the activity it was read at', () => {
  const err = { code: 'authentication_failed', text: 't', at: 1 }
  const cache: ErrorCache = { a: { at: 'T1', error: err } }
  expect(errorOf(cache, s('a', { lastActivityAt: 'T1' }))).toEqual(err)
  // the chat has moved on since: not shown until it is read again
  expect(errorOf(cache, s('a', { lastActivityAt: 'T2' }))).toBeUndefined()
  expect(errorOf(cache, s('b'))).toBeUndefined()
})

test('what the script printed becomes errors; text is unescaped, a missing code is just "error"', () => {
  const out = parseErrors(
    JSON.stringify({
      a: { status: '403', code: 'authentication_failed', text: 'Failed to authenticate. API Error: 403 \\"Cloudflare\\" \\u0441', at: '2026-11-13T09:47:34.004Z' },
      b: { status: '', code: '', text: 'x', at: '' },
    }),
  )
  expect(out['a']).toEqual({
    code: 'authentication_failed',
    status: 403,
    text: 'Failed to authenticate. API Error: 403 "Cloudflare" с',
    at: Date.parse('2026-11-13T09:47:34.004Z'),
  })
  expect(out['b']).toEqual({ code: 'error', text: 'x', at: 0 })
})

test('an unreadable answer is no errors', () => {
  expect(parseErrors('')).toEqual({})
  expect(parseErrors('not json')).toEqual({})
  expect(parseErrors('[]')).toEqual({})
  expect(parseErrors('{}')).toEqual({})
})

test('the error is named in words, with the status', () => {
  expect(errorLabel({ code: 'authentication_failed', status: 403, text: '', at: 0 })).toBe('помилка авторизації (403)')
  expect(errorLabel({ code: 'server_error', text: '', at: 0 })).toBe('помилка сервера')
  expect(errorLabel({ code: 'something_new', status: 500, text: '', at: 0 })).toBe('помилка (500)')
})

test('the script holds no double quote, carries the ids and takes only plain ids', () => {
  const script = errorsScript(['local_a', 'local_b-2'])
  expect(script).toContain("@('local_a','local_b-2')")
  expect(script.includes('"')).toBe(false)
  expect(() => errorsScript(["x'; Remove-Item *"])).toThrow()
})
