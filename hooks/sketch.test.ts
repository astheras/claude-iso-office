import { expect, test } from 'claude-code/testing'

import type { RawSession, SketchCache } from '../types'
import { askOf, CHUNK_BYTES, contextStep, hazeStep, MAX_SKETCHED, needsSketch, nextSketches, parseSketches, RUNNING_EVERY_MS, sizeStep, SKETCH_VERSION, sketchLook, sketchScript, withSketches } from './sketch'

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
    done: { at: AT, offset: 50, size: 50, v: SKETCH_VERSION },
    moved: { at: '2026-11-13T11:00:00.000Z', offset: 50, size: 50, v: SKETCH_VERSION },
    more: { at: AT, offset: 10, size: 50, v: SKETCH_VERSION },
    // read by an older reader, which did not know every field: read once more though nothing moved
    old: { at: AT, offset: 50, size: 50 },
  }
  const list = [raw('new'), raw('done'), raw('moved'), raw('more'), raw('old')]
  expect(needsSketch(list, cache, NOW).map(s => s.sessionId)).toEqual(['new', 'moved', 'more', 'old'])
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
  expect(next.a).toEqual({ at: AT, offset: 0, size: 0, none: true, v: SKETCH_VERSION })
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

// the call a transcript ends on, as the script prints it
const MCP = { name: 'mcp__Claude_Browser__browser_batch', at: '2026-11-13T11:55:00.000Z' }

test('a call to an MCP tool that nothing has answered is read as a server and a tool, with the time it was made', () => {
  expect(parseSketches(piece({ mcp: MCP })).a!.mcp).toEqual({ server: 'Claude_Browser', tool: 'browser_batch', at: Date.parse(MCP.at) })
  // a server name may have underscores: the first double underscore divides it from the tool
  expect(parseSketches(piece({ mcp: { name: 'mcp__ccd_session_mgmt__send_message' } })).a!.mcp).toEqual({ server: 'ccd_session_mgmt', tool: 'send_message' })
  // the call of any other tool, or something that is not a call, is nothing
  for (const bad of [{ name: 'Bash' }, { name: 'mcp__nothing' }, 'mcp__a__b', 5, null]) expect(parseSketches(piece({ mcp: bad })).a!.mcp).toBeUndefined()
})

test('the wait is the state at the end of the transcript: each read replaces it, and a read with no wait clears it', () => {
  const s = raw('a', { isRunning: true })
  const waiting = nextSketches({}, [s], [s], parseSketches(piece({ mcp: MCP })))
  expect(waiting.a!.mcp).toEqual({ server: 'Claude_Browser', tool: 'browser_batch', at: Date.parse(MCP.at) })
  expect(withSketches([s], waiting)[0]!.mcp).toEqual(waiting.a!.mcp)
  const after = nextSketches(waiting, [s], [s], parseSketches(piece({ from: 100, offset: 120, size: 120 })))
  expect(after.a!.mcp).toBeUndefined()
  expect(withSketches([s], after)[0]!.mcp).toBeUndefined()
  // the drawing is made again when a wait comes or goes
  expect(sketchLook(waiting)).not.toBe(sketchLook(after))
})

test('the script looks at the end of the chat for a call to an MCP tool that has not been answered', () => {
  const script = sketchScript([{ id: 'a', offset: 0 }])
  expect(script).toContain('mcp__')
  expect(script).toContain('tool_use_id')
  expect(script).toContain('mcp = $mcp')
  expect(script.includes('"')).toBe(false)
})

// what the script passes up for the tasks started in the background: the call, the answer that names it, the notice that ends it
const bgStart = (task: string) => [
  JSON.stringify({
    isSidechain: false,
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: `u-${task}`, name: 'Bash', input: { command: 'x', description: `run ${task}`, run_in_background: true } }] },
    timestamp: '2026-11-13T11:40:00.000Z',
  }),
  JSON.stringify({ isSidechain: false, type: 'user', message: { content: [{ tool_use_id: `u-${task}`, type: 'tool_result', content: `Command running in background with ID: ${task}.` }] } }),
]
const bgEnd = (task: string) =>
  JSON.stringify({ isSidechain: false, type: 'user', message: { content: `<task-notification><task-id>${task}</task-id><status>completed</status></task-notification>` } })

test('the tasks a chat started in the background are carried from piece to piece, and a piece that ends one takes it off', () => {
  const s = raw('a')
  const one = nextSketches({}, [s], [s], parseSketches(piece({ bg: [...bgStart('t1'), ...bgStart('t2')], offset: 60, size: 100 })))
  expect(one.a!.tasks!.map(t => t.id)).toEqual(['t1', 't2'])
  expect(withSketches([s], one)[0]!.tasks!.map(t => t.what)).toEqual(['run t1', 'run t2'])
  const two = nextSketches(one, [s], [s], parseSketches(piece({ from: 60, offset: 100, size: 100, bg: [bgEnd('t1')] })))
  expect(two.a!.tasks!.map(t => t.id)).toEqual(['t2'])
  // a piece with nothing about tasks keeps what was held; read again from the start, it holds nothing of the old
  const same = nextSketches(two, [s], [s], parseSketches(piece({ from: 100, offset: 120, size: 120 })))
  expect(same.a!.tasks!.map(t => t.id)).toEqual(['t2'])
  const again = nextSketches(two, [s], [s], parseSketches(piece({ from: 0, offset: 40, size: 40 })))
  expect(again.a!.tasks).toBeUndefined()
  // the last one ended: none
  const none = nextSketches(two, [s], [s], parseSketches(piece({ from: 100, offset: 120, size: 120, bg: [bgEnd('t2')] })))
  expect(none.a!.tasks).toBeUndefined()
  expect(withSketches([s], none)[0]!.tasks).toBeUndefined()
  // the drawing is made again when a task comes or goes
  expect(sketchLook(one)).not.toBe(sketchLook(two))
  expect(sketchLook(two)).not.toBe(sketchLook(none))
})

test('the lines the script passes up are what begins, names or ends a task; a lone line comes as a string', () => {
  expect(parseSketches(piece({ bg: 'one line' })).a!.bg).toEqual(['one line'])
  expect(parseSketches(piece({ bg: ['a', 5, 'b'] })).a!.bg).toEqual(['a', 'b'])
  expect(parseSketches(piece({})).a!.bg).toBeUndefined()
  const script = sketchScript([{ id: 'a', offset: 0 }])
  for (const word of ['run_in_background', 'Monitor', 'TaskStop', 'running in background with ID', 'Monitor started (task', '<task-notification>', 'bg = $bg']) {
    expect(script).toContain(word)
  }
  expect(script.includes('"')).toBe(false)
})

test('a question or a plan put to the person that nothing has answered is read as a decision, and is not an MCP wait', () => {
  const at = '2026-11-15T10:00:00.000Z'
  const ask = parseSketches(piece({ mcp: { name: 'AskUserQuestion', at } })).a!
  expect(ask.decision).toEqual({ kind: 'question', at: Date.parse(at) })
  expect(ask.mcp).toBeUndefined()
  expect(parseSketches(piece({ mcp: { name: 'ExitPlanMode' } })).a!.decision).toEqual({ kind: 'plan' })
  // a tool that is neither is no decision; an MCP call is no decision
  for (const other of [{ name: 'Bash' }, { name: 'AskUser' }, MCP, 'AskUserQuestion', 5, null]) {
    expect(parseSketches(piece({ mcp: other })).a!.decision).toBeUndefined()
  }
})

test('the decision is the state at the end of the transcript: a read replaces it, the drawing is made again when it comes or goes', () => {
  const s = raw('a', { isRunning: true })
  const asking = nextSketches({}, [s], [s], parseSketches(piece({ mcp: { name: 'ExitPlanMode' } })))
  expect(asking.a!.decision).toEqual({ kind: 'plan' })
  expect(withSketches([s], asking)[0]!.decision).toEqual({ kind: 'plan' })
  const after = nextSketches(asking, [s], [s], parseSketches(piece({ from: 100, offset: 120, size: 120 })))
  expect(after.a!.decision).toBeUndefined()
  expect(withSketches([s], after)[0]!.decision).toBeUndefined()
  expect(sketchLook(asking)).not.toBe(sketchLook(after))
})

test('the script looks for the two calls that put a decision to the person, and reads the Claude folder from where it may have been moved', () => {
  const script = sketchScript([{ id: 'a', offset: 0 }])
  expect(script).toContain('AskUserQuestion')
  expect(script).toContain('ExitPlanMode')
  // CLAUDE_CONFIG_DIR first, the home folder after: a folder moved to another disk is still found
  expect(script).toContain('$env:CLAUDE_CONFIG_DIR')
  expect(script.indexOf('$env:CLAUDE_CONFIG_DIR')).toBeLessThan(script.indexOf('$env:USERPROFILE'))
  expect(script.includes('"')).toBe(false)
})

test('the question a turn ended on is the JSON text of the chat file, read as plain text, with the time the turn ended', () => {
  expect(askOf('Що робимо з залишками КП?', '1794845643518')).toEqual({ text: 'Що робимо з залишками КП?', at: 1794845643518 })
  // escapes as the file spells them: an apostrophe as a backslash and u0027, a quote as a backslash and a quote
  const apostrophe = ['\\', 'u0027'].join('')
  expect(askOf(String.raw`Закомітити ${apostrophe}все${apostrophe} \"зараз\"?\n`, 5)).toEqual({ text: `Закомітити 'все' "зараз"?`, at: 5 })
  // a text that is not valid JSON once quoted is kept as it is
  expect(askOf(String.raw`a \q b`, undefined)).toEqual({ text: String.raw`a \q b` })
  // nothing asked: no question
  for (const none of ['', '   ', null, undefined, 5]) expect(askOf(none, 1)).toBeUndefined()
  // a time that is no time is left out
  expect(askOf('x', 'soon')).toEqual({ text: 'x' })
})

test('the question is read from the answer of the script, carried to the chat, and the drawing is made again when it comes or goes', () => {
  const s = raw('a')
  const asked = nextSketches({}, [s], [s], parseSketches(piece({ ask: 'Що далі?', edge: '1794845643518' })))
  expect(asked.a!.ask).toEqual({ text: 'Що далі?', at: 1794845643518 })
  expect(asked.a!.v).toBe(SKETCH_VERSION)
  expect(withSketches([s], asked)[0]!.turnAsk).toEqual({ text: 'Що далі?', at: 1794845643518 })
  // a later read of the same chat that finds no question clears it
  const after = nextSketches(asked, [s], [s], parseSketches(piece({ from: 100, offset: 120, size: 120 })))
  expect(after.a!.ask).toBeUndefined()
  expect(withSketches([s], after)[0]!.turnAsk).toBeUndefined()
  expect(sketchLook(asked)).not.toBe(sketchLook(after))
  // a run that read nothing leaves the question as it was, and does not ask again at once
  const kept = nextSketches(asked, [{ ...s, lastActivityAt: '2026-11-13T11:55:00.000Z' }], [{ ...s, lastActivityAt: '2026-11-13T11:55:00.000Z' }], {})
  expect(kept.a!.ask).toEqual(asked.a!.ask)
  expect(kept.a!.v).toBe(SKETCH_VERSION)
})

test('without a question in the chat file, the script takes it from the wrap-up call the transcript ends on, unless the person has spoken since', () => {
  const script = sketchScript([{ id: 'a', offset: 0 }])
  // the pattern for the `ask` of the call, and for a prompt of the person (a record of type user that answers no call)
  expect(script).toContain(String.raw`'ask' + $q + ':' + $q + '((?:[^' + $q + '\\]|\\.)*)'`)
  expect(script).toContain(`$pu = $q + 'type' + $q + ':' + $q + 'user' + $q`)
  // only when the file gave none, and read from the end back: a prompt stops the search, a call with no `ask` ends it with none
  expect(script).toContain('if (-not $ask) {')
  expect(script).toContain('elseif ($l.Contains($pu) -and -not $l.Contains($p8)) { break }')
  // a cache made before this fallback is read once more, or a chat read to its end would keep showing no question
  expect(SKETCH_VERSION).toBeGreaterThanOrEqual(3)
  expect(script.includes('"')).toBe(false)
})

test('the script reads the question and the end of the turn from the file of the chat itself', () => {
  const script = sketchScript([{ id: 'a', offset: 0 }])
  expect(script).toContain('needsUser')
  expect(script).toContain('lastTurnEdgeAt')
  // the pattern for the text: anything but a quote or a backslash, or a backslash and the character after it; PowerShell
  // keeps a backslash as it is, so the regex needs two to mean one
  expect(script).toContain(String.raw`\\]|\\.)*)`)
  expect(script.includes('"')).toBe(false)
})
