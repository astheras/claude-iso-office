import { expect, test } from 'claude-code/testing'

import { planCount, planFrom } from './plan'

let n = 0
/** A transcript line of the chat's own message with one tool call, the way the app writes it. */
const call = (name: string, input: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    parentUuid: 'p',
    isSidechain: false,
    message: { model: 'claude-opus-5-5', type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${++n}`, name, input }] },
    type: 'assistant',
    ...extra,
  })
const plan = (input: unknown, extra?: Record<string, unknown>) => call('mcp__ccd_turn__update_plan', input, extra)
const wrap = () => call('mcp__ccd_turn__wrap_up', { recap: 'done' })

const THREE = {
  items: [
    { content: 'Read the rules', status: 'in_progress' },
    { content: 'Write the parser', status: 'pending' },
    { content: 'Test it', status: 'pending' },
  ],
  scope: 'first_task',
}

const statuses = (lines: string[]) => planFrom(lines)?.map(p => p.status)

test('a chat that never made a list has no plan', () => {
  expect(planFrom([])).toBeUndefined()
  expect(planFrom(['not json', wrap()])).toBeUndefined()
})

test('the whole list is read as it was given', () => {
  expect(planFrom([plan(THREE)])).toEqual([
    { text: 'Read the rules', status: 'in_progress' },
    { text: 'Write the parser', status: 'pending' },
    { text: 'Test it', status: 'pending' },
  ])
})

test('advance finishes the step under way and starts the next one; past the last it just finishes', () => {
  expect(statuses([plan(THREE), plan({ advance: true })])).toEqual(['completed', 'in_progress', 'pending'])
  expect(statuses([plan(THREE), plan({ advance: true }), plan({ advance: true }), plan({ advance: true })])).toEqual([
    'completed',
    'completed',
    'completed',
  ])
})

test('done and start move steps by their number, one step under way at a time', () => {
  expect(statuses([plan(THREE), plan({ done: [1], start: 3 })])).toEqual(['completed', 'pending', 'in_progress'])
  // a jump without finishing: the step left behind waits again
  expect(statuses([plan(THREE), plan({ start: 2 })])).toEqual(['pending', 'in_progress', 'pending'])
  // numbers out of range change nothing
  expect(statuses([plan(THREE), plan({ done: [9], start: 0 })])).toEqual(['in_progress', 'pending', 'pending'])
})

test('a new whole list replaces the old one', () => {
  const next = { items: [{ content: 'Another task', status: 'in_progress' }], scope: 'new_task' }
  expect(planFrom([plan(THREE), plan({ advance: true }), plan(next)])).toEqual([{ text: 'Another task', status: 'in_progress' }])
})

test('the wrap-up at the end of a turn checks the list off', () => {
  expect(statuses([plan(THREE), plan({ advance: true }), wrap()])).toEqual(['completed', 'completed', 'completed'])
  // and a list made after it starts fresh
  expect(statuses([plan(THREE), wrap(), plan(THREE)])).toEqual(['in_progress', 'pending', 'pending'])
})

test('copies of what went to the model, helper agents, and a call seen twice do not count', () => {
  const twice = plan({ advance: true })
  expect(statuses([plan(THREE), twice, twice])).toEqual(['completed', 'in_progress', 'pending'])
  // the app keeps the request it sent, with the same calls in it, sometimes out of order
  const copy = JSON.stringify({ type: 'api-request-blob', message: JSON.parse(plan({ advance: true })).message })
  expect(statuses([plan(THREE), copy])).toEqual(['in_progress', 'pending', 'pending'])
  expect(statuses([plan(THREE), plan({ advance: true }, { isSidechain: true })])).toEqual(['in_progress', 'pending', 'pending'])
})

test('an odd step is kept as waiting, an empty one is left out', () => {
  const odd = { items: [{ content: 'A', status: 'blocked' }, { content: '  ', status: 'pending' }, { content: 'B' }] }
  expect(planFrom([plan(odd)])).toEqual([
    { text: 'A', status: 'pending' },
    { text: 'B', status: 'pending' },
  ])
})

test('the count says how many steps are done of all', () => {
  expect(planCount(planFrom([plan(THREE), plan({ advance: true })])!)).toEqual({ done: 1, total: 3 })
})
