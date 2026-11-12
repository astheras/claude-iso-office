import { expect, test } from 'claude-code/testing'

import { ack, classify, emptyMemory, groupSessions, HOME_MS, parseSessions, roomOf, WAIT_MS } from './data'
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
