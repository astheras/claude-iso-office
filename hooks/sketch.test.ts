import { expect, test } from 'claude-code/testing'

import type { RawSession, SketchCache } from '../types'
import { CHUNK_BYTES, contextStep, hazeStep, MAX_SKETCHED, needsSketch, nextSketches, parseSketches, RUNNING_EVERY_MS, sizeStep, sketchLook, sketchScript, withSketches } from './sketch'

const NOW = Date.parse('2026-11-13T12:00:00Z')
const AT = '2026-11-13T11:50:00.000Z'
const raw = (id: string, o: Partial<RawSession> = {}): RawSession => ({ sessionId: id, title: id, isRunning: false, lastActivityAt: AT, ...o })

let n = 0
const call = (name: string, input: unknown) =>
  JSON.stringify({ isSidechain: false, type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${++n}`, name, input }] } })
const plan = (input: unknown) => call('mcp__ccd_turn__update_plan', input)
const LIST = { items: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }] }
const cost = (out: number, cache: number) =>
  JSON.stringify({ type: 'cost-state', modelUsage: { m1: { outputTokens: out, cacheReadInputTokens: cache }, m2: { outputTokens: 10, cacheReadInputTokens: 5 } } })

const piece = (o: Record<string, unknown>) => JSON.stringify({ a: { from: 0, offset: 100, size: 100, plan: [], ...o } })

test('a chat is read when it was never read, when it moved, or when it was not read to the end', () => {
  const cache: SketchCache = {
    done: { at: AT, offset: 50, size: 50 },
    moved: { at: '2026-11-13T11:00:00.000Z', offset: 50, size: 50 },
    more: { at: AT, offset: 10, size: 50 },
  }
  const list = [raw('new'), raw('done'), raw('moved'), raw('more')]
  expect(needsSketch(list, cache, NOW).map(s => s.sessionId)).toEqual(['new', 'moved', 'more'])
})

test('a chat that is archived, or idle over three days, is not read', () => {
  const old = new Date(NOW - 74 * 3600000).toISOString()
  expect(needsSketch([raw('a', { isArchived: true }), raw('b', { lastActivityAt: old })], {}, NOW)).toEqual([])
  // but a running chat is read, whatever its last activity says
  expect(needsSketch([raw('c', { lastActivityAt: old, isRunning: true })], {}, NOW)).toHaveLength(1)
})

test('a running chat is read again at most every twenty seconds', () => {
  const cache: SketchCache = { r: { at: '2026-11-13T11:59:00.000Z', offset: 5, size: 5 } }
  const list = [raw('r', { isRunning: true, lastActivityAt: AT })]
  const readAt = new Map([['r', NOW - 5000]])
  expect(needsSketch(list, cache, NOW, readAt)).toEqual([])
  readAt.set('r', NOW - RUNNING_EVERY_MS - 1)
  expect(needsSketch(list, cache, NOW, readAt)).toHaveLength(1)
})

test('one run reads a few chats, not all of them', () => {
  const many = Array.from({ length: MAX_SKETCHED + 8 }, (_, i) => raw(`s${i}`))
  expect(needsSketch(many, {}, NOW)).toHaveLength(MAX_SKETCHED)
})

test('the script holds no double quote, names each chat with its offset, and takes only plain ids', () => {
  const s = sketchScript([{ id: 'local_a-1', offset: 0 }, { id: 'local_b', offset: 1234 }])
  expect(s.includes('"')).toBe(false)
  expect(s).toContain("'local_a-1:0;local_b:1234'")
  expect(s).toContain(String(CHUNK_BYTES))
  expect(() => sketchScript([{ id: "x'; Remove-Item *", offset: 0 }])).toThrow()
  expect(() => sketchScript([{ id: 'ok', offset: -1 }])).toThrow()
  expect(() => sketchScript([{ id: 'ok', offset: 1.5 }])).toThrow()
})

test('what the script printed is read per chat, and anything else is nothing', () => {
  expect(parseSketches('')).toEqual({})
  expect(parseSketches('nope')).toEqual({})
  expect(parseSketches('{"a":{"none":true}}')).toEqual({ a: { none: true, from: 0, offset: 0, size: 0, plan: [] } })
  const one = parseSketches(JSON.stringify({ a: { from: 0, offset: 9, size: 20, plan: 'line', cost: 'c' }, b: { offset: 'x' } }))
  expect(one.a).toEqual({ from: 0, offset: 9, size: 20, plan: ['line'], cost: 'c' })
  expect(one.b).toBeUndefined()
})

test('a first read gives the plan and the tokens; the next read carries on from them', () => {
  const s = raw('a')
  const first = nextSketches({}, [s], [s], parseSketches(piece({ offset: 60, size: 100, plan: [plan(LIST)], cost: cost(5000, 2_000_000) })))
  expect(first.a!.plan!.map(p => p.status)).toEqual(['in_progress', 'pending'])
  expect(first.a!.out).toBe(5010)
  expect(first.a!.cache).toBe(2_000_005)
  // not read to the end: it is wanted again
  expect(needsSketch([s], first, NOW).map(x => x.sessionId)).toEqual(['a'])

  const second = nextSketches(first, [s], [s], parseSketches(piece({ from: 60, offset: 100, size: 100, plan: [plan({ advance: true })] })))
  expect(second.a!.plan!.map(p => p.status)).toEqual(['completed', 'in_progress'])
  // no cost line in this piece: the tokens are kept
  expect(second.a!.out).toBe(5010)
  expect(needsSketch([s], second, NOW)).toEqual([])
})

test('a transcript that was rewritten is read again from the start, what was held is let go', () => {
  const s = raw('a')
  const held: SketchCache = { a: { at: '2026-11-13T09:00:00.000Z', offset: 900, size: 900, plan: [{ text: 'Old', status: 'completed' }], out: 99999 } }
  const next = nextSketches(held, [s], [s], parseSketches(piece({ from: 0, offset: 40, size: 40, plan: [] })))
  expect(next.a!.plan).toBeUndefined()
  expect(next.a!.out).toBeUndefined()
})

test('a chat with no transcript is marked, and read again only when it moves', () => {
  const s = raw('a')
  const next = nextSketches({}, [s], [s], parseSketches('{"a":{"none":true}}'))
  expect(next.a).toEqual({ at: AT, offset: 0, size: 0, none: true })
  expect(needsSketch([s], next, NOW)).toEqual([])
})

test('a run that found nothing leaves a chat as it was and does not ask again at once', () => {
  const s = raw('a')
  const held: SketchCache = { a: { at: '2026-11-13T09:00:00.000Z', offset: 10, size: 99, plan: [{ text: 'A', status: 'pending' }] } }
  const next = nextSketches(held, [s], [s], {})
  expect(next.a!.plan).toEqual([{ text: 'A', status: 'pending' }])
  expect(next.a!.at).toBe(AT)
  expect(needsSketch([s], next, NOW)).toEqual([])
  // and a chat never read becomes "no transcript", not a retry loop
  expect(nextSketches({}, [s], [s], {}).a!.none).toBe(true)
})

test('chats that are no longer listed are dropped from the cache', () => {
  const held: SketchCache = { gone: { at: AT, offset: 1, size: 1 }, a: { at: AT, offset: 1, size: 1 } }
  expect(Object.keys(nextSketches(held, [raw('a')], [], {}))).toEqual(['a'])
})

test('tokens are written in steps, and laid on the chats as the plan statuses and the two sizes', () => {
  expect([0, 999, 1000, 9999, 10_000, 99_999, 100_000, 499_999, 500_000].map(sizeStep)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4])
  expect([0, 99_999, 100_000, 999_999, 1e6, 9_999_999, 1e7].map(hazeStep)).toEqual([0, 0, 1, 1, 2, 2, 3])
  const cache: SketchCache = {
    a: { at: AT, offset: 1, size: 1, plan: [{ text: 'A', status: 'completed' }, { text: 'B', status: 'in_progress' }], out: 53_688, cache: 8_968_059 },
  }
  const [a, b] = withSketches([raw('a'), raw('b')], cache)
  expect(a!.plan).toEqual(['completed', 'in_progress'])
  expect(a!.weight).toEqual({ size: 2, haze: 2 })
  expect(b).toEqual(raw('b'))
})

test('the look of the cache changes only when something on screen would', () => {
  const a: SketchCache = { x: { at: AT, offset: 5, size: 5, plan: [{ text: 'A', status: 'pending' }], out: 2000, cache: 0 } }
  // more bytes read, the same steps, the same statuses: the same look
  const b: SketchCache = { x: { at: 'later', offset: 9, size: 9, plan: [{ text: 'A, reworded', status: 'pending' }], out: 2500, cache: 10 } }
  expect(sketchLook(a)).toBe(sketchLook(b))
  const c: SketchCache = { x: { ...a.x!, plan: [{ text: 'A', status: 'completed' }] } }
  expect(sketchLook(c)).not.toBe(sketchLook(a))
})

// a reply of the chat itself, with what the model was given to read
const reply = (input: number, cacheRead: number, cacheWrite: number) =>
  JSON.stringify({ parentUuid: 'p', isSidechain: false, type: 'assistant', message: { usage: { input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite, output_tokens: 9 } } })

test('the context is what the last reply was given to read, in steps: the more it holds the bigger the system', () => {
  expect([0, 19_999, 20_000, 59_999, 60_000, 149_999, 150_000, 399_999, 400_000].map(contextStep)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4])
  const s = raw('a')
  const first = nextSketches({}, [s], [s], parseSketches(piece({ ctx: reply(4, 290_040, 770), offset: 60, size: 100 })))
  expect(first.a!.context).toBe(290_814)
  expect(withSketches([s], first)[0]!.weight!.size).toBe(3)
  // a piece with no reply keeps what was held; one with a newer reply takes it
  const same = nextSketches(first, [s], [s], parseSketches(piece({ from: 60, offset: 100, size: 100 })))
  expect(same.a!.context).toBe(290_814)
  const newer = nextSketches(first, [s], [s], parseSketches(piece({ from: 60, offset: 100, size: 100, ctx: reply(2, 30_000, 100) })))
  expect(newer.a!.context).toBe(30_102)
  expect(withSketches([s], newer)[0]!.weight!.size).toBe(1)
})

test('a reply that read nothing (an error reply) is not a context of nothing', () => {
  const s = raw('a')
  const held: SketchCache = { a: { at: AT, offset: 5, size: 5, context: 90_000 } }
  const next = nextSketches(held, [s], [s], parseSketches(piece({ from: 5, offset: 9, size: 9, ctx: reply(0, 0, 0) })))
  expect(next.a!.context).toBe(90_000)
})

test('a chat with no context read yet is sized by what it has written, as before', () => {
  const cache: SketchCache = { a: { at: AT, offset: 1, size: 1, out: 53_688 } }
  expect(withSketches([raw('a')], cache)[0]!.weight!.size).toBe(2)
})

test('the script also keeps the last reply of the chat itself, and not those of helper agents', () => {
  const script = sketchScript([{ id: 'a', offset: 0 }])
  expect(script).toContain('cache_read_input_tokens')
  expect(script).toContain(':false')
  expect(script).toContain('ctx = $ctx')
  expect(script.includes('"')).toBe(false)
})

test('the look of the cache follows the context step', () => {
  const a: SketchCache = { x: { at: AT, offset: 5, size: 5, context: 10_000 } }
  const b: SketchCache = { x: { at: AT, offset: 5, size: 5, context: 15_000 } }
  const c: SketchCache = { x: { at: AT, offset: 5, size: 5, context: 70_000 } }
  expect(sketchLook(a)).toBe(sketchLook(b))
  expect(sketchLook(a)).not.toBe(sketchLook(c))
})
