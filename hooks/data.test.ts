import { expect, test } from 'claude-code/testing'

import { ack, classify, emptyMemory, groupSessions, HOME_MS, parseSessions, roomOf, summary, WAIT_MS } from './data'
import { MAX_TASK_MS } from './tasks'
import type { RawSession } from '../types'

const NOW = Date.parse('2026-11-12T12:00:00Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const s = (id: string, over: Partial<RawSession> = {}): RawSession => ({
  sessionId: id,
  title: id,
  cwd: 'D:\\work\\my project',
  isRunning: false,
  lastActivityAt: iso(60_000),
  ...over,
})

test('rooms come from the project folder', () => {
  expect(roomOf('D:\\work\\my project').name).toBe('my project')
  expect(roomOf('D:\\work\\shop\\server').name).toBe('shop/server')
  expect(roomOf('/home/user').type).toBe('remote')
  expect(roomOf('C:\\x\\scratch-workspaces\\a\\b').type).toBe('cowork')
  expect(roomOf(undefined).type).toBe('cowork')
})

test('the first poll shows no finish events', () => {
  const out = classify([s('a', { isRunning: true }), s('b')], emptyMemory(), NOW)
  expect(out.events.length).toBe(0)
  expect(out.rooms[0]!.workers.map(w => w.kind)).toEqual(['work', 'rest'])
})

test('a worker that stops after running waits, then rests', () => {
  const first = classify([s('a', { isRunning: true })], emptyMemory(), NOW)
  const second = classify([s('a')], first.memory, NOW + 5000)
  expect(second.events.map(e => e.id)).toEqual(['a'])
  expect(second.rooms[0]!.workers[0]!.kind).toBe('wait')

  const later = classify([s('a')], second.memory, NOW + 5000 + WAIT_MS + 1)
  expect(later.events.length).toBe(0)
  expect(later.rooms[0]!.workers[0]!.kind).toBe('rest')
})

test('looking at a finished worker sends it back to rest', () => {
  const first = classify([s('a', { isRunning: true })], emptyMemory(), NOW)
  const second = classify([s('a')], first.memory, NOW + 5000)
  const third = classify([s('a')], ack(second.memory, 'a'), NOW + 10_000)
  expect(third.rooms[0]!.workers[0]!.kind).toBe('rest')
})

test('idle over a day goes home and is only counted', () => {
  const out = classify([s('old', { lastActivityAt: iso(HOME_MS + 1000) }), s('new')], emptyMemory(), NOW)
  expect(out.rooms[0]!.homeCount).toBe(1)
  expect(out.rooms[0]!.workers.map(w => w.id)).toEqual(['new'])
})

test('forks are interns of a session in the list; archived ones are skipped', () => {
  const out = classify([s('p'), s('f', { startedBy: 'p' }), s('x', { isArchived: true })], emptyMemory(), NOW)
  const f = out.rooms[0]!.workers.find(w => w.id === 'f')
  expect(f?.parentId).toBe('p')
  expect(out.rooms[0]!.workers.length).toBe(2)
})

test('rooms with work come first; open PRs are listed once', () => {
  const out = classify(
    [
      s('a', { cwd: 'D:\\a', prNumber: 34, prState: 'OPEN' }),
      s('b', { cwd: 'D:\\a', prNumber: 34, prState: 'OPEN' }),
      s('c', { cwd: 'D:\\b', isRunning: true }),
    ],
    emptyMemory(),
    NOW,
  )
  expect(out.rooms.map(r => r.name)).toEqual(['b', 'a'])
  expect(out.rooms[1]!.prNumbers).toEqual([34])
})

test('the list text is parsed, and anything else is refused', () => {
  expect(parseSessions('[{"sessionId":"x","title":"t","isRunning":false,"lastActivityAt":"2026-01-01T00:00:00Z"}]').length).toBe(1)
  expect(() => parseSessions('{"error":1}')).toThrow()
})

test('a change of kind is remembered with the one before it, and only from the second poll', () => {
  const first = classify([s('a', { isRunning: true })], emptyMemory(), NOW)
  expect(first.rooms[0]!.workers[0]!.prevKind).toBeUndefined()

  const second = classify([s('a')], first.memory, NOW + 5000)
  const w2 = second.rooms[0]!.workers[0]!
  expect([w2.kind, w2.prevKind, w2.changedAt]).toEqual(['wait', 'work', NOW + 5000])

  // nothing changes: the time of the change stays
  const third = classify([s('a')], second.memory, NOW + 10_000)
  const w3 = third.rooms[0]!.workers[0]!
  expect([w3.kind, w3.prevKind, w3.changedAt]).toEqual(['wait', 'work', NOW + 5000])
})

test('sessions are listed in three groups: needs an answer, working, finished and waiting', () => {
  const first = classify([s('fin', { isRunning: true })], emptyMemory(), NOW)
  const out = classify(
    [
      s('work', { isRunning: true, lastActivityAt: iso(1000) }),
      s('ask', { isRunning: true, needsAnswer: true }),
      s('fin'),
      s('idle'),
      s('other', { cwd: 'D:\\work\\shop', isRunning: true, lastActivityAt: iso(500) }),
    ],
    first.memory,
    NOW,
  )
  const groups = groupSessions(out.rooms)
  expect(groups.map(g => g.key)).toEqual(['ask', 'work', 'done'])
  expect(groups[0]!.items.map(x => x.w.id)).toEqual(['ask'])
  // the freshest first, across projects; each item carries its project
  expect(groups[1]!.items.map(x => [x.w.id, x.room.name])).toEqual([
    ['other', 'shop'],
    ['work', 'my project'],
  ])
  expect(groups[2]!.items.map(x => x.w.id)).toEqual(['fin'])
  // resting sessions are in no group, and a chosen project lists its own only
  expect(groups.flatMap(g => g.items).some(x => x.w.id === 'idle')).toBe(false)
  const mine = groupSessions(out.rooms.filter(r => r.name === 'my project'))
  expect(mine.flatMap(g => g.items.map(x => x.room.name))).not.toContain('shop')
})

test('a group with nobody in it is left out', () => {
  expect(groupSessions(classify([s('a')], emptyMemory(), NOW).rooms)).toEqual([])
})

const FAIL = { code: 'authentication_failed', status: 403, text: 'Failed to authenticate.', at: NOW - 5 * 60_000 }

test('a chat whose last turn failed is listed first, and a failure outranks every other group', () => {
  const out = classify(
    [
      s('bad'),
      // it waits for the person too, but the failure is what matters
      s('bad-ask', { needsAnswer: true, error: FAIL }),
      s('work', { isRunning: true }),
      s('ask', { needsAnswer: true }),
    ].map(x => (x.sessionId === 'bad' ? { ...x, error: FAIL } : x)),
    emptyMemory(),
    NOW,
  )
  const groups = groupSessions(out.rooms)
  expect(groups.map(g => g.key)).toEqual(['err', 'ask', 'work'])
  expect(groups[0]!.items.map(x => x.w.id).sort()).toEqual(['bad', 'bad-ask'])
  expect(groups[0]!.color).toBe('#E5534B')
  expect(groups[1]!.items.map(x => x.w.id)).toEqual(['ask'])
})

test('a running chat is past its failed turn: the failure is dropped, and nothing else is lost', () => {
  const out = classify([s('a', { isRunning: true, error: FAIL })], emptyMemory(), NOW)
  const w = out.rooms[0]!.workers[0]!
  expect(w.error).toBeUndefined()
  expect(w.kind).toBe('work')
})

test('the summary counts the chats with a failure, and says nothing when there are none', () => {
  const failed = classify([s('a', { error: FAIL }), s('b', { isRunning: true })], emptyMemory(), NOW)
  expect(summary(failed.rooms)).toBe('працюють 1, чекають 0, з помилкою 1')
  expect(summary(classify([s('b', { isRunning: true })], emptyMemory(), NOW).rooms)).toBe('працюють 1, чекають 0')
})

test('a chat that stopped while chats it started still run waits for them, in its own group', () => {
  const out = classify(
    [
      s('parent'),
      s('kid1', { isRunning: true, startedBy: 'parent', title: 'Розвідка' }),
      s('kid2', { isRunning: true, startedBy: 'parent', title: 'Звіт' }),
      s('idle-kid', { startedBy: 'parent' }),
      // a parent that is itself running is just working
      s('busy', { isRunning: true }),
      s('kid3', { isRunning: true, startedBy: 'busy' }),
    ],
    emptyMemory(),
    NOW,
  )
  const groups = groupSessions(out.rooms)
  expect(groups.map(g => g.key)).toEqual(['agent', 'work'])
  const p = groups[0]!.items[0]!.w
  expect(p.id).toBe('parent')
  expect(p.waitsFor!.map(x => x.title)).toEqual(['Розвідка', 'Звіт'])
  expect(groups[1]!.items.map(x => x.w.id).sort()).toEqual(['busy', 'kid1', 'kid2', 'kid3'])
  // once the children stop, it no longer waits
  const after = classify([s('parent'), s('kid1', { startedBy: 'parent' })], emptyMemory(), NOW)
  expect(groupSessions(after.rooms)).toEqual([])
})

test('a chat waits for the colleague it asked, as well as for chats it started, but only while it is stopped', () => {
  const ask = [{ id: 'food', title: 'Їжа для комплексів', on: 'Unity' }]
  const out = classify(
    [
      s('asker', { waitsFor: ask }),
      s('both', { waitsFor: ask }),
      s('kid', { isRunning: true, startedBy: 'both', title: 'Розвідка' }),
      s('busy', { isRunning: true, waitsFor: ask }),
    ],
    emptyMemory(),
    NOW,
  )
  const byId = Object.fromEntries(out.rooms.flatMap(r => r.workers).map(w => [w.id, w]))
  expect(byId['asker']!.waitsFor).toEqual(ask)
  expect(byId['both']!.waitsFor!.map(x => x.title)).toEqual(['Розвідка', 'Їжа для комплексів'])
  // a running chat is not waiting, whatever it once asked
  expect(byId['busy']!.waitsFor).toBeUndefined()
  expect(groupSessions(out.rooms)[0]!.key).toBe('agent')
})

test('a running chat carries the MCP call it is held up by; a stopped one does not (a call left open there is a leftover)', () => {
  const mcp = { server: 'Claude_Browser', tool: 'browser_batch', at: NOW - 60_000 }
  const out = classify([s('run', { isRunning: true, mcp }), s('stopped', { mcp })], emptyMemory(), NOW)
  const byId = Object.fromEntries(out.rooms.flatMap(r => r.workers).map(w => [w.id, w]))
  expect(byId['run']!.mcp).toEqual(mcp)
  expect(byId['stopped']!.mcp).toBeUndefined()
})

test('a stopped chat whose background tasks are still going waits for them, in a list of its own; a running one, an old task and a chat in error or asking do not', () => {
  const task = (id: string, at = NOW - 60_000) => ({ id, kind: 'bash' as const, what: `task ${id}`, at })
  const out = classify(
    [
      s('idle', { tasks: [task('t1')] }),
      s('busy', { isRunning: true, tasks: [task('t2')] }),
      s('old', { tasks: [task('t3', NOW - MAX_TASK_MS - 1)] }),
      s('failed', { tasks: [task('t4')], error: { code: 'x', text: 'e', at: NOW } }),
      s('asks', { tasks: [task('t5')], needsAnswer: true }),
    ],
    emptyMemory(),
    NOW,
  )
  const byId = Object.fromEntries(out.rooms.flatMap(r => r.workers).map(w => [w.id, w]))
  expect(byId['idle']!.tasks!.map(t => t.id)).toEqual(['t1'])
  // while a chat runs, what it started is its own work; a task that old is taken for lost
  expect(byId['busy']!.tasks).toBeUndefined()
  expect(byId['old']!.tasks).toBeUndefined()
  // an error and a question to the person outrank it, but the tasks are still known
  expect(groupSessions(out.rooms).map(g => [g.key, g.items.map(x => x.w.id)])).toEqual([
    ['err', ['failed']],
    ['ask', ['asks']],
    ['task', ['idle']],
    ['work', ['busy']],
  ])
  expect(byId['failed']!.tasks).toHaveLength(1)
})

test('a project room knows its folder, so that a new session can be started in it; other rooms do not', () => {
  const at = new Date().toISOString()
  const raw = [
    { sessionId: 'a', title: 'a', cwd: 'D:\\work\\alpha', isRunning: true, lastActivityAt: at },
    { sessionId: 'b', title: 'b', cwd: 'C:\\Users\\x\\scratch-workspaces\\y', isRunning: true, lastActivityAt: at },
    { sessionId: 'c', title: 'c', cwd: '/home/x/app', isRunning: true, lastActivityAt: at },
  ]
  const rooms = classify(raw, emptyMemory(), Date.now()).rooms
  const byType = Object.fromEntries(rooms.map(r => [r.type, r.cwd]))
  expect(byType.project).toBe('D:\\work\\alpha')
  expect(byType.cowork).toBeUndefined()
  expect(byType.remote).toBeUndefined()
})

test('a chat that waits on the person and has put a decision to them has a list of its own, ahead of the plain asks', () => {
  const decision = { kind: 'question' as const, at: NOW - 60_000 }
  const out = classify(
    [
      s('ask', { needsAnswer: true }),
      s('pick', { needsAnswer: true, isRunning: true, decision }),
      s('plan', { needsAnswer: true, decision: { kind: 'plan' } }),
      // a decision the registry does not confirm (the chat is not blocked on the person) is no decision
      s('stale', { isRunning: true, decision }),
      s('bad', { needsAnswer: true, decision, error: FAIL }),
    ],
    emptyMemory(),
    NOW,
  )
  const groups = groupSessions(out.rooms)
  expect(groups.map(g => g.key)).toEqual(['err', 'decide', 'ask', 'work'])
  expect(groups[1]!.title).toBe('Чекають рішення')
  expect(groups[1]!.items.map(x => x.w.id).sort()).toEqual(['pick', 'plan'])
  expect(groups[2]!.items.map(x => x.w.id)).toEqual(['ask'])
  expect(groups[3]!.items.map(x => x.w.id)).toEqual(['stale'])
  // a colour of its own: not the orange of a permission
  expect(groups[1]!.color).not.toBe(groups[2]!.color)
  expect(out.rooms[0]!.workers.find(w => w.id === 'stale')!.decision).toBeUndefined()
})
