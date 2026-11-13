import { expect, test } from 'claude-code/testing'

import type { ErrorCache, RawSession } from '../types'
import { errorLabel, errorOf, errorsScript, isAsk, needsCheck, nextCache, parseErrors, parsePeers, peerOf, waitOf } from './errors'

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
      s('old', { lastActivityAt: iso(74 * 3600_000) }), // past the three days: not listed, not read
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

// the messages the two Unity sessions really sent each other (shortened)
const REAL_ASK_UK = 'Питання по Editor: мені потрібне вікно ≈15 хв для ХБ.7: Refresh + EditMode + пара прогонів стенду. Якщо ти зараз у Play, скажи, коли звільниться. Якщо вільно, напиши «вільно».'
const REAL_ASK_EN = 'Your xb4-a and xb4-b files are both in Logs/CitySimulationStand, and the editor shows not Play. Are you done with it? If you still need Play, tell me how long. If you\'re done, write «вільно».'
const REAL_CLAIM_UK = 'Дякую. Беру Editor зараз: Refresh + компіляція, EditMode, пара прогонів стенду (≈15 хв). Не запускай Run і tests-run, поки я не напишу «вільно».'
const REAL_CLAIM_EN = "Your xb3-b-168 has finished and the editor is idle, so I'm taking it for about 15 minutes. Don't start Run in the meantime; I'll write when I'm done."
const REAL_FREE_UK = 'вільно. Мої прогони (xb7-a/b) і EditMode (3241 з 3241) завершено, Editor не в Play і не компілюється. Дякую.'
const REAL_FREE_EN = "The editor is free again: I'm done with my DR.2 runs. It is not in Play, nothing is compiling and no probes are left in it."

test('a question to a colleague is a wait; taking the editor and giving it back are not', () => {
  expect([REAL_ASK_UK, REAL_ASK_EN].map(isAsk)).toEqual([true, true])
  expect([REAL_CLAIM_UK, REAL_CLAIM_EN, REAL_FREE_UK, REAL_FREE_EN].map(isAsk)).toEqual([false, false, false, false])
})

test('the unanswered request the script found is a wait, for Unity when it is about the editor', () => {
  const out = parsePeers(
    JSON.stringify({
      a: { peerTo: 'Їжа для комплексів', peerId: '', peerAt: '2026-11-13T10:00:00.000Z', peerText: REAL_ASK_UK },
      b: { peerTo: '', peerId: 'local_peer', peerAt: '2026-11-13T10:00:00.000Z', peerText: 'Чи можна, будь ласка, глянути на PR?' },
      c: { peerTo: 'x', peerText: REAL_FREE_UK },
      d: { code: 'server_error', text: 'x' },
    }),
  )
  expect(Object.keys(out)).toEqual(['a', 'b'])
  expect(out['a']!.to).toBe('Їжа для комплексів')
  expect(out['b']!.id).toBe('local_peer')

  const listed = [s('food', { title: 'Їжа для комплексів' }), s('local_peer', { title: 'Peer' })]
  expect(waitOf(out['a']!, listed)).toEqual({ id: 'food', title: 'Їжа для комплексів', on: 'Unity' })
  // by session id, and about nothing in particular: no "Unity"
  expect(waitOf(out['b']!, listed)).toEqual({ id: 'local_peer', title: 'Peer' })
  // a chat that is not in the list is still named as it was addressed
  expect(waitOf({ to: 'Gone', id: '', text: 'Editor?', at: 0 }, [])).toEqual({ id: 'Gone', title: 'Gone', on: 'Unity' })
  expect(waitOf({ to: '', id: '', text: '?', at: 0 }, [])).toBeUndefined()
})

test('a wait is read once per activity and is shown only at that activity', () => {
  const ask = { to: 'x', id: '', text: 'Editor?', at: 1 }
  const raw = [s('a', { lastActivityAt: 'T1' })]
  const cache = nextCache({}, raw, raw, {}, { a: ask })
  expect(cache['a']).toEqual({ at: 'T1', peer: ask })
  expect(peerOf(cache, s('a', { lastActivityAt: 'T1' }))).toEqual(ask)
  expect(peerOf(cache, s('a', { lastActivityAt: 'T2' }))).toBeUndefined()
})

test('an entry that only holds a request to a colleague is not an error', () => {
  expect(parseErrors(JSON.stringify({ a: { peerTo: 'x', peerText: 'Editor?' } }))).toEqual({})
})
