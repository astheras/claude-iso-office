import { expect, test } from 'claude-code/testing'

import type { Subagent } from '../types'
import { agentLine, agentRows, agentState, agentsScriptLines, callText, hasLiveAgent, lastCall, MAX_AGENTS, modelText, parseAgents, QUIET_MS } from './agents'

const NOW = Date.parse('2026-11-18T12:00:00Z')
const MIN = 60_000

// what the script printed for a real chat: a helper at work (no `finished`, no prefix file yet), and one that is over (shortened)
const meta = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ agentType: 'Explore', isBuiltIn: true, description: 'Probe subagent files', toolUseId: 'toolu_A', spawnDepth: 1, model: 'haiku', ...over })

// a line of the helper's transcript: the assistant calls a tool
const toolLine = (name: string, input: Record<string, unknown>, model = 'claude-haiku-5-5') =>
  JSON.stringify({ type: 'assistant', message: { model, content: [{ type: 'thinking', thinking: '...' }, { type: 'tool_use', id: 't', name, input }] } })

const running = { meta: meta(), at: NOW - 4000, model: 'claude-haiku-5-5', tool: toolLine('Read', { file_path: 'D:\\work\\claude-iso-office\\hooks\\galaxy.ts' }) }
const over = { meta: meta({ toolUseId: 'toolu_B', agentType: 'general-purpose', description: 'Triage freight run test failures', model: undefined, finished: true }), at: NOW - 9 * MIN, model: 'claude-opus-5-5', tool: null }

test('a helper at work has no `finished`; its model is the one it ran on, not the alias it was asked for, and its call is named', () => {
  const [a] = parseAgents([running])!
  expect(a).toEqual({
    id: 'toolu_A',
    type: 'Explore',
    what: 'Probe subagent files',
    model: 'claude-haiku-5-5',
    asked: 'haiku',
    done: false,
    at: NOW - 4000,
    doing: 'Read galaxy.ts',
    depth: 1,
  })
})

test('a helper that is over is done; it has no call in the middle of, even if the script passed one; no alias is no `asked`', () => {
  const [a] = parseAgents([{ ...over, tool: toolLine('Bash', { command: 'ls' }) }])!
  expect(a!.done).toBe(true)
  expect(a!.doing).toBeUndefined()
  expect(a!.asked).toBeUndefined()
  expect(a!.model).toBe('claude-opus-5-5')
})

test('a lone helper may come as a bare table; one whose record cannot be read is passed over; none at all is nothing', () => {
  expect(parseAgents(running)!.length).toBe(1)
  expect(parseAgents([{ meta: 'not json', at: 1 }, running, null, 7, { at: 3 }])!.length).toBe(1)
  expect(parseAgents([{ meta: '[]' }])).toBeUndefined()
  expect(parseAgents([])).toBeUndefined()
  expect(parseAgents(null)).toBeUndefined()
  expect(parseAgents('x')).toBeUndefined()
})

test('a record with little in it still gives a helper: the kind falls back to a word, the id to a counter', () => {
  const [a] = parseAgents([{ meta: '{}', at: null }])!
  expect(a).toEqual({ id: 'агент-0', type: 'агент', done: false })
  expect(modelText(a!)).toBe('модель невідома')
  expect(modelText({ ...a!, asked: 'sonnet' })).toBe('sonnet (запит)')
  expect(modelText({ ...a!, asked: 'sonnet', model: 'claude-sonnet-5-5' })).toBe('claude-sonnet-5-5')
})

test('a call is told as a name and the one thing that says what it is, files by their last part', () => {
  expect(callText('Read', { file_path: 'D:\\a\\b\\galaxy.ts' })).toBe('Read galaxy.ts')
  expect(callText('Edit', { file_path: '/x/y/z.ts' })).toBe('Edit z.ts')
  expect(callText('Grep', { pattern: 'isSidechain' })).toBe('Grep isSidechain')
  expect(callText('Glob', { pattern: '**/*.ts' })).toBe('Glob **/*.ts')
  expect(callText('Bash', { command: 'npm   test\n --silent' })).toBe('Bash npm test --silent')
  expect(callText('Agent', { description: 'Find files' })).toBe('Agent Find files')
  expect(callText('SubagentHandback', { message: 'long report' })).toBe('здає звіт')
  // an unknown tool, or a call with nothing to show, is just its name
  expect(callText('mcp__x__y', { a: 1 })).toBe('mcp__x__y')
  expect(callText('Read', {})).toBe('Read')
  // a long argument is cut
  expect(callText('Bash', { command: 'x'.repeat(200) }).length).toBeLessThan(70)
})

test('of a line of the assistant the last call is taken; a line with none, or that is not readable, gives nothing', () => {
  const two = JSON.stringify({ message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }, { type: 'tool_use', name: 'Grep', input: { pattern: 'p' } }] } })
  expect(lastCall(two)).toBe('Grep p')
  expect(lastCall(JSON.stringify({ message: { content: [{ type: 'text', text: 'done' }] } }))).toBeUndefined()
  expect(lastCall('{"message":')).toBeUndefined()
  expect(lastCall(undefined)).toBeUndefined()
  expect(lastCall(JSON.stringify({ message: { content: 'plain' } }))).toBeUndefined()
})

const agent = (over: Partial<Subagent> = {}): Subagent => ({ id: 'i', type: 'Explore', model: 'claude-haiku-5-5', done: false, at: NOW - 5000, ...over })

test('not over and recently written is at work; not over and quiet a long while is quiet; over is done', () => {
  expect(agentState(agent(), NOW)).toBe('run')
  expect(agentState(agent({ at: NOW - QUIET_MS - 1 }), NOW)).toBe('quiet')
  expect(agentState(agent({ at: NOW - QUIET_MS }), NOW)).toBe('run')
  // no time known: believed to be at work
  expect(agentState(agent({ at: undefined }), NOW)).toBe('run')
  expect(agentState(agent({ done: true, at: NOW - 99 * MIN }), NOW)).toBe('done')
  expect(hasLiveAgent([agent({ done: true }), agent({ at: NOW - 30 * MIN })], NOW)).toBe(false)
  expect(hasLiveAgent([agent({ done: true }), agent()], NOW)).toBe(true)
  expect(hasLiveAgent(undefined, NOW)).toBe(false)
})

test('a helper is one line: kind, model, task, and when it ended or how long it has been quiet', () => {
  const a = agent({ what: 'Triage failures' })
  expect(agentLine(a, 'run', NOW)).toBe('Explore · claude-haiku-5-5 · Triage failures')
  expect(agentLine({ ...a, done: true, at: NOW - 12 * MIN }, 'done', NOW)).toBe('Explore · claude-haiku-5-5 · Triage failures · 12 хв тому')
  expect(agentLine({ ...a, at: NOW - 25 * MIN }, 'quiet', NOW)).toBe('Explore · claude-haiku-5-5 · Triage failures · без руху 25 хв')
  // one that another helper started is marked
  expect(agentLine({ ...a, depth: 2 }, 'run', NOW).startsWith('↳ ')).toBe(true)
})

test('the rows count the helpers, put the ones at work first with their call under them, then the quiet, then the over ones', () => {
  const rows = agentRows(
    [
      agent({ id: 'old', done: true, at: NOW - 60 * MIN, what: 'old one' }),
      agent({ id: 'new', done: true, at: NOW - 2 * MIN, what: 'new one' }),
      agent({ id: 'q', at: NOW - 30 * MIN, what: 'quiet one' }),
      agent({ id: 'r', what: 'busy one', doing: 'Grep isSidechain' }),
    ],
    NOW,
  )
  expect(rows.map(r => r[0])).toEqual(['Субагенти', '▶', '', '…', '✓', '✓'])
  expect(rows[0]![1]).toBe('1 працює · 1 без руху · 2 завершено')
  expect(rows[1]![1]).toBe('Explore · claude-haiku-5-5 · busy one')
  expect(rows[2]![1]).toBe('зараз: Grep isSidechain')
  expect(rows[3]![1]).toContain('quiet one')
  // the over ones: the newest first
  expect(rows[4]![1]).toContain('new one')
  expect(rows[5]![1]).toContain('old one')
})

test('only the call of a helper at work is told; a long list is cut and the rest counted; no helpers, no rows', () => {
  const done = agent({ done: true, doing: 'Read x.ts' })
  expect(agentRows([done], NOW).some(r => r[1].startsWith('зараз'))).toBe(false)
  const many = Array.from({ length: MAX_AGENTS + 3 }, (_, i) => agent({ id: String(i), done: true, at: NOW - i * MIN }))
  const rows = agentRows(many, NOW)
  expect(rows.length).toBe(1 + MAX_AGENTS + 1)
  expect(rows[rows.length - 1]).toEqual(['', 'і ще 3'])
  expect(agentRows([], NOW)).toEqual([])
})

test('the script reads the folder beside the transcript, only the tail of a helper\'s transcript, and holds no double quote', () => {
  const script = agentsScriptLines().join('\n')
  expect(script.includes('"')).toBe(false)
  expect(script).toContain("'\\subagents'")
  expect(script).toContain("'agent-*.meta.json'")
  expect(script).toContain('-Tail 40')
  // a line that holds a copy of a file is not read
  expect(script).toContain('$_.Length -lt 6000')
  // the model of one that is over, which its tail may not tell
  expect(script).toContain("'.prefix.json'")
})
