import { expect, test } from 'claude-code/testing'

import type { BgTask } from '../types'
import { MAX_TASK_MS, openTasks, tasksFrom } from './tasks'

const NOW = Date.parse('2026-11-15T09:00:00Z')
const at = (secs: number) => new Date(NOW + secs * 1000).toISOString()

// the records as the transcript keeps them
const use = (id: string, name: string, input: Record<string, unknown>, secs = 0, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ isSidechain: false, type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }, timestamp: at(secs), ...extra })
const answer = (id: string, text: string) =>
  JSON.stringify({ isSidechain: false, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: text }] } })
const notice = (task: string, status?: string, event = '') =>
  JSON.stringify({
    isSidechain: false,
    type: 'user',
    message: {
      role: 'user',
      content: `<task-notification>\n<task-id>${task}</task-id>\n${status ? `<status>${status}</status>\n` : ''}<summary>s</summary>${event ? `\n<event>${event}</event>` : ''}\n</task-notification>`,
    },
  })
// the same notice as the queue keeps it
const queued = (task: string, status: string) =>
  JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: `<task-notification><task-id>${task}</task-id><status>${status}</status></task-notification>` })

const command = (id: string, task: string, description: string, text = 'sleep 1', secs = 0) => [
  use(id, 'Bash', { command: text, description, run_in_background: true }, secs),
  answer(id, `Command running in background with ID: ${task}. Output is being written to: C:\\x\\${task}.output`),
]
const monitor = (id: string, task: string, description: string, secs = 5) => [
  use(id, 'Monitor', { command: 'until x; do sleep 1; done', description, timeout_ms: 1500000, persistent: false }, secs),
  answer(id, `Monitor started (task ${task}, expires in 25m unless the source ends first; you get one notice at expiry)`),
]

test('a command run in the background and a monitor are tasks, named by their descriptions and the ids the answers give', () => {
  const tasks = tasksFrom([...command('u1', 'bg1', 'Run the stand'), ...monitor('u2', 'mon1', 'Wait for the stand')])
  expect(tasks.map(t => [t.id, t.kind, t.what])).toEqual([
    ['bg1', 'bash', 'Run the stand'],
    ['mon1', 'monitor', 'Wait for the stand'],
  ])
  // when each began is the time of the call
  expect(tasks.map(t => t.at)).toEqual([NOW, NOW + 5000])
  // not tasks: a command that is waited for, and a call whose answer never named a task
  expect(tasksFrom([use('u3', 'Bash', { command: 'ls', description: 'List' }), answer('u3', 'a b c')])).toEqual([])
  expect(tasksFrom([command('u4', 'bg4', 'Never answered')[0]!])).toEqual([])
  // a long description is cut, and one missing is the command
  expect(tasksFrom(command('u5', 'bg5', 'x'.repeat(300)))[0]!.what).toHaveLength(120)
  expect(tasksFrom([use('u6', 'Bash', { command: 'python  run.py', run_in_background: true }), answer('u6', 'Command running in background with ID: bg6.')])[0]!.what).toBe('python run.py')
})

test('a task that goes to an MCP server is said to: by its description or by the text of its command', () => {
  const mcpOf = (description: string, text: string) => tasksFrom(command('u1', 'bg1', description, text))[0]!.mcp
  expect(mcpOf('Run the tests through the MCP endpoint', 'sleep 1')).toBe(true)
  expect(mcpOf('Run the batch', 'python mcp.py script-execute x')).toBe(true)
  expect(mcpOf('Run the batch', 'python run.py')).toBeUndefined()
})

test('a notice with a status ends a task, so does the monitor expiring or a stop; one more event of a monitor does not', () => {
  const start = [...command('u1', 'bg1', 'one'), ...command('u2', 'bg2', 'two'), ...monitor('u3', 'mon3', 'three'), ...monitor('u4', 'mon4', 'four'), ...command('u5', 'bg5', 'five')]
  const open = (...more: string[]) => tasksFrom([...start, ...more]).map(t => t.id)
  expect(open()).toEqual(['bg1', 'bg2', 'bg5', 'mon3', 'mon4'])
  expect(open(notice('bg1', 'completed'))).toEqual(['bg2', 'bg5', 'mon3', 'mon4'])
  // the copy in the queue ends it too, and a notice seen twice is no harm
  expect(open(queued('bg2', 'completed'), notice('bg2', 'completed'))).toEqual(['bg1', 'bg5', 'mon3', 'mon4'])
  // an event of a monitor with no status: it goes on; the notice of its expiry ends it
  expect(open(notice('mon3', undefined, 'seed 1 done'))).toContain('mon3')
  expect(open(notice('mon3', undefined, '[Monitor expired after 25m with no events delivered]'))).toEqual(['bg1', 'bg2', 'bg5', 'mon4'])
  // stopped by the chat
  expect(open(use('u9', 'TaskStop', { task_id: 'bg5' }))).toEqual(['bg1', 'bg2', 'mon3', 'mon4'])
  // a notice for a task never seen is nothing
  expect(open(notice('unknown', 'completed'))).toEqual(['bg1', 'bg2', 'bg5', 'mon3', 'mon4'])
})

test('what a helper agent started is not the chat\'s own, and a line that is not readable is passed over', () => {
  const side = use('u1', 'Bash', { command: 'x', description: 'helper', run_in_background: true }, 0, { isSidechain: true })
  expect(tasksFrom([side, answer('u1', 'Command running in background with ID: bg1.')])).toEqual([])
  expect(tasksFrom(['not json', '{"type":', ...command('u2', 'bg2', 'ok')]).map(t => t.id)).toEqual(['bg2'])
})

test('a transcript read in pieces: what the earlier pieces left open goes on, and a later piece can end it', () => {
  const first = tasksFrom([...command('u1', 'bg1', 'one'), ...command('u2', 'bg2', 'two')])
  expect(first.map(t => t.id)).toEqual(['bg1', 'bg2'])
  const second = tasksFrom([notice('bg1', 'completed'), ...command('u3', 'bg3', 'three', 'sleep 1', 20)], first)
  expect(second.map(t => t.id)).toEqual(['bg2', 'bg3'])
  // the held tasks are not changed by it
  expect(first).toHaveLength(2)
})

test('a task left open for half a day is taken for lost; one with no time is believed', () => {
  const t = (id: string, at?: number): BgTask => ({ id, kind: 'bash', what: id, ...(at !== undefined ? { at } : {}) })
  const tasks = [t('new', NOW - 60_000), t('old', NOW - MAX_TASK_MS - 1), t('untimed')]
  expect(openTasks(tasks, NOW).map(x => x.id)).toEqual(['new', 'untimed'])
  expect(openTasks(undefined, NOW)).toEqual([])
})
