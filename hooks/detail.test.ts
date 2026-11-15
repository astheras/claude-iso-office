import { expect, test } from 'claude-code/testing'

import type { Room, Worker } from '../types'
import { compact, detailRows, detailScript, dollars, lasting, mcpName, parseDetail, stateSince, waitsText } from './detail'

const NOW = Date.parse('2026-11-12T12:00:00Z')
const MIN = 60_000

// what the script printed for a real chat that used two models (shortened)
const REAL = JSON.stringify({
  meta: {
    cliSessionId: '8532e1e9',
    model: 'claude-sonnet-5-5',
    effort: 'high',
    permissionMode: 'auto',
    createdAt: String(NOW - 3 * 60 * MIN),
    lastTurnEdgeAt: String(NOW - 12 * MIN),
    completedTurns: '22',
  },
  cost: JSON.stringify({
    type: 'cost-state',
    totalCostUSD: 7.717038699999998,
    totalAPIDuration: 510793,
    totalToolDuration: 276218,
    totalDuration: 80969611,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    hasUnknownModelCost: false,
    modelUsage: {
      'claude-sonnet-5-5': { inputTokens: 46, outputTokens: 10579, thinkingTokens: 2730, cacheReadInputTokens: 2908761, cacheCreationInputTokens: 340811 },
      'claude-opus-5-5': { inputTokens: 2147, outputTokens: 43109, thinkingTokens: 7010, cacheReadInputTokens: 6059298, cacheCreationInputTokens: 484396 },
    },
  }),
})

const worker = (over: Partial<Worker> = {}): Worker => ({
  id: 'w',
  title: 'Chat',
  link: 'claude://x/w',
  kind: 'work',
  activityAt: NOW,
  changedAt: NOW - 2 * MIN,
  ...over,
})
const room: Room = { key: 'k', name: 'my project', type: 'project', workers: [], homeCount: 0, prNumbers: [] }

test('what the disk read printed is turned into numbers, the models added together', () => {
  const d = parseDetail(REAL)
  expect(Math.round((d.costUSD ?? 0) * 1000)).toBe(7717)
  expect(d.tokens).toEqual({ input: 2193, output: 53688, thinking: 9740, cacheRead: 8968059, cacheWrite: 825207 })
  expect(d.model).toBe('claude-sonnet-5-5')
  expect(d.turns).toBe(22)
  expect(d.turnEdgeAt).toBe(NOW - 12 * MIN)
  expect(d.apiMs).toBe(510793)
  expect(d.wallMs).toBe(80969611)
})

test('an unreadable or empty answer gives no details and no error', () => {
  expect(parseDetail('')).toEqual({})
  expect(parseDetail('not json')).toEqual({})
  expect(parseDetail('{"meta":null,"cost":null}')).toEqual({})
  // a cost line that is cut off loses the cost and nothing else
  const cut = JSON.stringify({ meta: { model: 'm' }, cost: '{"type":"cost-state","totalCos' })
  expect(parseDetail(cut)).toEqual({ model: 'm' })
})

test('numbers are written short', () => {
  expect([compact(90), compact(1500), compact(224205), compact(8968059), compact(1000000)]).toEqual(['90', '1.5k', '224k', '9M', '1M'])
  expect([dollars(7.717), dollars(0.004), dollars(0)]).toEqual(['$7.72', '<$0.01', '$0.00'])
  expect([lasting(500), lasting(21_000), lasting(12 * MIN), lasting(65 * MIN), lasting(120 * MIN), lasting(26 * 60 * MIN)]).toEqual([
    'менше секунди',
    '21 с',
    '12 хв',
    '1 год 5 хв',
    '2 год',
    '1 д 2 год',
  ])
})

test('how long the present state has lasted comes from the best source there is', () => {
  const d = parseDetail(REAL)
  // running: since its turn began
  expect(stateSince(worker(), d)).toBe(NOW - 12 * MIN)
  // waiting for an answer: since the registry says it began
  expect(stateSince(worker({ needsAnswer: true, askedAt: NOW - 7 * MIN }), d)).toBe(NOW - 7 * MIN)
  // nothing read from disk: since the plugin saw the change
  expect(stateSince(worker(), undefined)).toBe(NOW - 2 * MIN)
})

test('the accordion lists what is known, in order, and leaves out what is not', () => {
  const rows = Object.fromEntries(detailRows(worker({ prNumber: 34 }), room, { ...parseDetail(REAL), branch: 'feature/x', prState: 'OPEN', context: { used: 224000, window: 1000000, percent: 22 } }, NOW))
  expect(rows['Стан']).toBe('працює · 12 хв')
  expect(rows['Вартість']).toBe('$7.72')
  expect(rows['Токени']).toBe('вихід 53.7k · вхід 2.2k · міркування 9.7k')
  expect(rows['Кеш']).toBe('читання 9M · запис 825k')
  expect(rows['Контекст']).toBe('224k з 1M · 22%')
  expect(rows['Модель']).toBe('claude-sonnet-5-5 · high')
  expect(rows['Ходів']).toBe('22')
  expect(rows['Гілка']).toBe('feature/x')
  expect(rows['PR']).toBe('#34 · OPEN')
  expect(rows['Проєкт']).toBe('my project')
  expect(rows['Код']).toBe('+0 −0')

  // with nothing read yet, only the state and the project are there
  expect(detailRows(worker(), room, undefined, NOW).map(r => r[0])).toEqual(['Стан', 'Проєкт'])
})

test('a cost with an unpriced model is shown as a lower bound', () => {
  const partial = JSON.stringify({ meta: null, cost: JSON.stringify({ totalCostUSD: 1, hasUnknownModelCost: true }) })
  expect(Object.fromEntries(detailRows(worker(), room, parseDetail(partial), NOW))['Вартість']).toBe('≥ $1.00')
})

test('the disk-read script holds no double quote and takes only a plain id', () => {
  const script = detailScript('local_d1caa14d-5954-4412-b41b-abd8ecc01f6a')
  expect(script).toContain("'local_d1caa14d-5954-4412-b41b-abd8ecc01f6a'")
  expect(script.includes('"')).toBe(false)
  expect(() => detailScript("x'; Remove-Item *")).toThrow()
  expect(() => detailScript('')).toThrow()
})

test('what a chat waits for is one line, and all of it in the accordion', () => {
  const w = worker({ kind: 'rest', waitsFor: [{ id: 'a', title: 'Розвідка' }, { id: 'b', title: 'Звіт' }, { id: 'c', title: 'Тест' }] })
  expect(waitsText(w)).toBe('Розвідка і ще 2')
  expect(waitsText(worker())).toBeUndefined()
  const rows = Object.fromEntries(detailRows(w, room, undefined, NOW))
  expect(rows['Стан']).toMatch(/^чекає іншого агента/)
  expect(rows['Чекає']).toBe('Розвідка; Звіт; Тест')
})

test('a wait for Unity names the chat that holds it', () => {
  const w = worker({ kind: 'rest', waitsFor: [{ id: 'f', title: 'Їжа для комплексів', on: 'Unity' }] })
  expect(waitsText(w)).toBe('Unity (Їжа для комплексів)')
  expect(Object.fromEntries(detailRows(w, room, undefined, NOW))['Чекає']).toBe('Unity (Їжа для комплексів)')
})

test('a chat held up by an MCP tool names the server and the tool in the accordion, and for how long', () => {
  const w = worker({ kind: 'work', mcp: { server: 'Claude_Browser', tool: 'browser_batch', at: NOW - 3 * MIN } })
  expect(mcpName(w.mcp!)).toBe('Claude_Browser · browser_batch')
  const row = (x: Worker) => Object.fromEntries(detailRows(x, room, undefined, NOW))['Чекає MCP']
  expect(row(w)).toBe('Claude_Browser · browser_batch · 3 хв')
  // without the time of the call, the name alone
  expect(row(worker({ kind: 'work', mcp: { server: 's', tool: 't' } }))).toBe('s · t')
  // a question to the person is another wait, and a chat held up by nothing has no row
  expect(row({ ...w, needsAnswer: true })).toBeUndefined()
  expect(row(worker({ kind: 'work' }))).toBeUndefined()
})

test('a chat with a task list shows how far it has got, then each step with its mark', () => {
  const plan = [
    { text: 'Read the rules', status: 'completed' as const },
    { text: 'Write the parser', status: 'in_progress' as const },
    { text: 'Test it', status: 'pending' as const },
  ]
  const rows = detailRows(worker(), room, { plan }, NOW)
  const at = rows.findIndex(r => r[0] === 'План')
  expect(rows[at]![1]).toBe('1 з 3')
  expect(rows.slice(at + 1, at + 4).map(r => `${r[0]} ${r[1]}`)).toEqual(['✓ Read the rules', '▶ Write the parser', '○ Test it'])
  // no list, no plan lines
  expect(detailRows(worker(), room, {}, NOW).some(r => r[0] === 'План')).toBe(false)
})
