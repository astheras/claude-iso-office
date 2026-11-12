import { expect, test } from 'claude-code/testing'

import { assignRest, floorSvg, MAX_ROOMS, SIZE_LIMIT } from './floor'
import type { Kind, Room, Worker } from '../types'

const NOW = Date.parse('2026-11-12T12:00:00Z')
const w = (id: string, kind: Kind, over: Partial<Worker> = {}): Worker => ({
  id,
  title: 'chat ' + id,
  link: 'claude://x/' + id,
  kind,
  activityAt: NOW - 60_000,
  changedAt: NOW - 3_600_000,
  ...over,
})
const room = (name: string, workers: Worker[], over: Partial<Room> = {}): Room => ({
  key: name,
  name,
  type: 'project',
  workers,
  homeCount: 0,
  prNumbers: [],
  ...over,
})

test('one scene for all rooms, one titled figure per shown worker', () => {
  const out = floorSvg(
    [room('alpha', [w('a', 'work'), w('b', 'wait'), w('c', 'rest')]), room('beta', [w('d', 'rest'), w('e', 'rest')])],
    NOW,
  )
  expect(out.svg.startsWith('<svg ')).toBe(true)
  expect(out.svg.endsWith('</svg>')).toBe(true)
  expect(out.shownWorkers).toBe(5)
  expect((out.svg.match(/<title>chat /g) ?? []).length).toBe(5)
  expect(out.labels.map(l => l.name)).toEqual(['alpha', 'beta'])
  expect(out.spots.length).toBe(5)
})

test('workers at a desk and in the break area are drawn differently', () => {
  const desk = floorSvg([room('r', [w('a', 'work')])], NOW).svg
  const rest = floorSvg([room('r', [w('a', 'rest')])], NOW).svg
  expect(desk).toContain('<use href="#se')
  expect(desk).not.toContain('animateMotion')
  expect(rest).toContain('animateMotion') // a lone rester goes for a coffee
  expect(rest).not.toContain('<use href="#se')
})

test('resting workers are placed in pairs; nobody talks alone', () => {
  const slots = (n: number) => {
    const rest = Array.from({ length: n }, (_, i) => w('s' + i, 'rest'))
    return [...assignRest(rest).values()]
  }
  expect(slots(1)).toEqual(['coffee0'])
  expect(slots(2).sort()).toEqual(['talk0', 'talk1'])
  const six = slots(6)
  expect(six.includes('talk2')).toBe(false)
  expect(six.filter(s => s.startsWith('talk')).length % 2).toBe(0)
  expect(new Set(slots(8)).size).toBe(8)
})

test('a recent change between desk and break area plays a walk, an old one does not', () => {
  const fresh = floorSvg([room('r', [w('a', 'work', { prevKind: 'rest', changedAt: NOW - 1000 })])], NOW).svg
  const old = floorSvg([room('r', [w('a', 'work', { prevKind: 'rest', changedAt: NOW - 60_000 })])], NOW).svg
  const same = floorSvg([room('r', [w('a', 'work', { prevKind: 'wait', changedAt: NOW - 1000 })])], NOW).svg
  expect(fresh).toContain('fill="freeze"')
  expect(old).not.toContain('fill="freeze"')
  expect(same).not.toContain('fill="freeze"') // wait <-> work stays at the desk
})

test('the room label carries open PRs, who is at home and who is not shown', () => {
  const many = Array.from({ length: 12 }, (_, i) => w('m' + i, 'rest'))
  const out = floorSvg([room('big', many, { prNumbers: [34], homeCount: 5 })], NOW)
  expect(out.labels[0]!.sub).toBe('PR 34 · вдома: 5 · ще: 4') // 8 desks per room
})

test('the busiest case fits the size limit; rooms past the cap are counted, not drawn', () => {
  const rooms = Array.from({ length: MAX_ROOMS + 2 }, (_, r) =>
    room(
      'room' + r,
      Array.from({ length: 12 }, (_, i) => w(`r${r}w${i}`, (['work', 'wait', 'rest'] as const)[i % 3] as Kind)),
    ),
  )
  const out = floorSvg(rooms, NOW)
  expect(out.svg.length).toBeLessThanOrEqual(SIZE_LIMIT)
  expect(out.hiddenRooms).toBe(2)
})

test('an empty office and a room with nobody at a desk still draw', () => {
  expect(floorSvg([], NOW).svg).toContain('</svg>')
  expect(floorSvg([room('quiet', [], { homeCount: 3 })], NOW).labels[0]!.sub).toBe('вдома: 3')
})

test('interns are smaller and titles are escaped', () => {
  const out = floorSvg([room('r', [w('<x>', 'work', { parentId: 'p', title: '<b>&' })])], NOW).svg
  expect(out).toContain('scale(0.8)')
  expect(out).toContain('&lt;b&gt;&amp;')
})

test('every shown worker has a click spot inside the scene, and only the picked one has a ring', () => {
  const rooms = [room('r', [w('a', 'work'), w('b', 'wait'), w('c', 'rest'), w('d', 'rest')])]
  const out = floorSvg(rooms, NOW, 'b')
  expect(out.spots.map(s => s.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  for (const sp of out.spots) {
    expect(sp.x).toBeGreaterThan(0)
    expect(sp.x).toBeLessThan(out.width)
    expect(sp.y).toBeGreaterThan(0)
    expect(sp.y).toBeLessThan(out.height)
  }
  expect((out.svg.match(/<ellipse /g) ?? []).length).toBe(1)
  expect((floorSvg(rooms, NOW).svg.match(/<ellipse /g) ?? []).length).toBe(0)
})
