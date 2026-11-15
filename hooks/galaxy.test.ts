import { expect, test } from 'claude-code/testing'

import type { Kind, PlanStatus, Room, Worker } from '../types'
import { GROUP_COLOR } from './data'
import { MAX_ROOMS, SIZE_LIMIT } from './floor'
import { galaxySvg, REST_COLOR, steady } from './galaxy'

const NOW = Date.parse('2026-11-13T12:00:00Z')

const w = (id: string, kind: Kind = 'work', o: Partial<Worker> = {}): Worker => ({
  id,
  title: `chat ${id}`,
  link: `claude://x/${id}`,
  kind,
  activityAt: NOW - 60_000,
  changedAt: NOW - 3_600_000,
  ...o,
})
const room = (key: string, workers: Worker[], o: Partial<Room> = {}): Room => ({
  key,
  name: key,
  type: 'project',
  workers,
  homeCount: 0,
  prNumbers: [],
  ...o,
})

const D: PlanStatus = 'completed'
const N: PlanStatus = 'in_progress'
const F: PlanStatus = 'pending'

/** The marks of one star, cut out of the drawing. */
const star = (svg: string, id: string): string => {
  const i = svg.indexOf(`<g data-s="${id}"`)
  expect(i).toBeGreaterThan(-1)
  return svg.slice(i, svg.indexOf('</g>', i) + 4)
}
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

test('a galaxy per project, a star per session, each with a place to press and a name to press', () => {
  const out = galaxySvg([room('alpha', [w('a'), w('b', 'wait')]), room('beta', [w('c')])], NOW)
  expect(out.svg.startsWith('<svg ')).toBe(true)
  expect(out.svg.endsWith('</svg>')).toBe(true)
  expect(out.shownWorkers).toBe(3)
  expect(out.spots.map(s => s.id).sort()).toEqual(['a', 'b', 'c'])
  expect(out.labels.map(l => l.name)).toEqual(['alpha', 'beta'])
  // the name is in the drawing, and the pane lays an invisible button of this width over it
  expect(out.labels.every(l => l.dark === true)).toBe(true)
  expect(out.spots.every(s => s.x > 0 && s.x < out.width && s.y > 0 && s.y < out.height)).toBe(true)
})

test('it is the same every time, and stars stand where their ids put them whatever the order of the list', () => {
  const ws = ['a', 'b', 'c', 'd', 'e'].map(id => w(id))
  const one = galaxySvg([room('r', ws)], NOW)
  expect(galaxySvg([room('r', ws)], NOW).svg).toBe(one.svg)
  const other = galaxySvg([room('r', [...ws].reverse())], NOW)
  const at = (s: typeof one) => Object.fromEntries(s.spots.map(p => [p.id, [p.x, p.y]]))
  expect(at(other)).toEqual(at(one))
})

test('a session that comes does not move the ones that are there, unless it takes their place', () => {
  const before = galaxySvg([room('r', [w('a'), w('b')])], NOW)
  const after = galaxySvg([room('r', [w('a'), w('b'), w('c')])], NOW)
  const at = (s: typeof before, id: string) => s.spots.find(p => p.id === id)
  const moved = ['a', 'b'].filter(id => JSON.stringify(at(before, id)) !== JSON.stringify(at(after, id)))
  expect(moved.length).toBeLessThanOrEqual(1)
})

test('stars are not so close that their buttons would cover each other', () => {
  const ws = Array.from({ length: 10 }, (_, i) => w(`s${i}`))
  const out = galaxySvg([room('r', ws)], NOW)
  for (let i = 0; i < out.spots.length; i++) {
    for (let j = i + 1; j < out.spots.length; j++) {
      const a = out.spots[i]!
      const b = out.spots[j]!
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(30)
    }
  }
})

test('a star has the colour of the list its session stands in, and an idle one is plain', () => {
  const ws = [
    w('e', 'rest', { error: { code: 'x', text: 't', at: NOW } }),
    w('q', 'work', { needsAnswer: true }),
    w('p', 'rest', { waitsFor: [{ id: 'z', title: 'z' }] }),
    w('k', 'work'),
    w('d', 'wait'),
    w('i', 'rest'),
  ]
  const out = galaxySvg([room('r', ws)], NOW)
  const colorOf = (id: string) => star(out.svg, id).match(/<circle cx="[\d.]+" cy="[\d.]+" r="[\d.]+" fill="(#[0-9A-F]{6})"\/><circle/)![1]
  expect(colorOf('e')).toBe(GROUP_COLOR.err)
  expect(colorOf('q')).toBe(GROUP_COLOR.ask)
  expect(colorOf('p')).toBe(GROUP_COLOR.agent)
  expect(colorOf('k')).toBe(GROUP_COLOR.work)
  expect(colorOf('d')).toBe(GROUP_COLOR.done)
  expect(colorOf('i')).toBe(REST_COLOR)
})

test('each state has its own mark: a flash for an error, a beacon for a question, a ray for waiting, a pulse for work', () => {
  const ws = [
    w('e', 'rest', { error: { code: 'x', text: 't', at: NOW } }),
    w('q', 'work', { needsAnswer: true, askedAt: NOW - 10 * 60000 }),
    w('p', 'rest', { waitsFor: [{ id: 'z', title: 'z' }] }),
    w('k', 'work'),
    w('d', 'wait'),
  ]
  const { svg } = galaxySvg([room('r', ws)], NOW)
  expect(star(svg, 'e')).toContain('data-k="err"')
  expect(star(svg, 'e')).not.toContain('<animate')
  expect(star(svg, 'q')).toContain('data-k="ask"')
  expect(star(svg, 'q')).toContain('attributeName="r"')
  expect(star(svg, 'k')).toContain('attributeName="opacity"')
  // the quiet ones do not move
  expect(star(svg, 'd')).not.toContain('<animate')
  // waiting for a chat that is not on the screen: a short ray out of the star
  expect(count(svg, /data-k="wait"/g)).toBe(1)
})

test('a beacon opens wider the longer the person has been kept waiting', () => {
  const reach = (mins: number) => {
    const { svg } = galaxySvg([room('r', [w('q', 'work', { needsAnswer: true, askedAt: NOW - mins * 60000 })])], NOW)
    return Number(star(svg, 'q').match(/attributeName="r" values="[\d.]+;([\d.]+)"/)![1])
  }
  expect(reach(0)).toBeLessThan(reach(10))
  expect(reach(10)).toBeLessThan(reach(60))
  // but not without end
  expect(reach(600)).toBe(reach(1000))
})

test('a session waiting for another is joined to its star when that star is on the screen', () => {
  const ws = [w('a', 'work'), w('b', 'rest', { waitsFor: [{ id: 'a', title: 'a' }] })]
  const { svg } = galaxySvg([room('r', ws)], NOW)
  expect(svg).toMatch(/data-k="wait" d="M[\d. -]+L[\d. -]+"/)
  // across galaxies too
  const across = galaxySvg([room('r1', [w('a')]), room('r2', [w('b', 'rest', { waitsFor: [{ id: 'a', title: 'a' }] })])], NOW).svg
  expect(across).toMatch(/data-k="wait" d="M[\d. -]+L/)
})

test('a session that waits is joined to every star it waits for, by a line in the colour of the wait that ends in an arrow', () => {
  const ws = [
    w('a', 'work'),
    w('c', 'work'),
    w('b', 'rest', { waitsFor: [{ id: 'a', title: 'a' }, { id: 'c', title: 'c' }] }),
  ]
  const { svg } = galaxySvg([room('r', ws)], NOW)
  expect(count(svg, /data-k="wait"/g)).toBe(2)
  expect(count(svg, /data-k="wait-head"/g)).toBe(2)
  expect(svg.match(/data-k="wait" [^>]*stroke="([^"]+)"/)![1]).toBe(GROUP_COLOR.agent)
  // a dashed ring that turns on the one that waits, a solid one on each that is waited for, and on no one else
  expect(star(svg, 'b')).toContain('data-k="waiting"')
  expect(star(svg, 'b')).not.toContain('data-k="awaited"')
  for (const id of ['a', 'c']) {
    expect(star(svg, id)).toContain('data-k="awaited"')
    expect(star(svg, id)).not.toContain('data-k="waiting"')
  }
  const quiet = galaxySvg([room('r', [w('a', 'work'), w('d', 'wait'), w('i', 'rest')])], NOW).svg
  expect(quiet).not.toContain('data-k="waiting"')
  expect(quiet).not.toContain('data-k="awaited"')
})

test('the line runs from the ring of the one that waits to the ring of the one waited for, the tip of its arrow on that ring', () => {
  const out = galaxySvg([room('r', [w('a', 'work'), w('b', 'rest', { waitsFor: [{ id: 'a', title: 'a' }] })])], NOW)
  const at = (id: string) => out.spots.find(s => s.id === id)!
  const ringOf = (id: string, k: string) => Number(star(out.svg, id).match(new RegExp(`data-k="${k}"[^>]* r="([\\d.]+)"`))![1])
  const away = (m: RegExpMatchArray, id: string) => Math.hypot(Number(m[1]) - at(id).x, Number(m[2]) - at(id).y)
  const line = out.svg.match(/data-k="wait" d="M([\d.-]+) ([\d.-]+)L/)!
  const head = out.svg.match(/data-k="wait-head" d="M([\d.-]+) ([\d.-]+)L/)!
  expect(Math.abs(away(line, 'b') - ringOf('b', 'waiting'))).toBeLessThan(0.3)
  expect(Math.abs(away(head, 'a') - ringOf('a', 'awaited'))).toBeLessThan(0.3)
  // outside the arcs that turn round a working star
  expect(ringOf('a', 'awaited')).toBeGreaterThan(ringOf('a', 'spin') + 2)
})

test('the ring of a star that is waited for lies outside the ring of its plan', () => {
  const rooms = [
    room('r1', [w('a', 'work', { plan: [D, N] }), w('b', 'rest', { waitsFor: [{ id: 'a', title: 'a' }] })]),
    room('r2', [w('c')]),
  ]
  const a = star(galaxySvg(rooms, NOW).svg, 'a')
  const plan = Number(a.match(/data-p="d" d="M[\d.]+ [\d.]+A([\d.]+) /)![1])
  const ring = Number(a.match(/data-k="awaited"[^>]* r="([\d.]+)"/)![1])
  expect(ring).toBeGreaterThan(plan + 2.5)
})

test('a session that waits and is waited for has both rings, the dashed one outside the solid one', () => {
  const ws = [
    w('a', 'work'),
    w('b', 'rest', { waitsFor: [{ id: 'a', title: 'a' }] }),
    w('c', 'rest', { waitsFor: [{ id: 'b', title: 'b' }] }),
  ]
  const b = star(galaxySvg([room('r', ws)], NOW).svg, 'b')
  const ringOf = (k: string) => Number(b.match(new RegExp(`data-k="${k}"[^>]* r="([\\d.]+)"`))![1])
  expect(Math.abs(ringOf('waiting') - ringOf('awaited') - 3.5)).toBeLessThan(0.15)
})

test('what a session waits for and is not on the screen is one short arrow out of it, besides the lines to those that are', () => {
  const ws = [w('a', 'work'), w('b', 'rest', { waitsFor: [{ id: 'a', title: 'a' }, { id: 'z', title: 'z' }, { id: 'y', title: 'y' }] })]
  const { svg } = galaxySvg([room('r', ws)], NOW)
  expect(count(svg, /data-k="wait"/g)).toBe(2)
  expect(count(svg, /data-k="wait-head"/g)).toBe(2)
})

test('a session that waits for the one it started has the line of the wait between them, not the thread of the tie as well', () => {
  const ws = [w('p', 'rest', { waitsFor: [{ id: 'k', title: 'k' }] }), w('k', 'work', { parentId: 'p' })]
  const { svg } = galaxySvg([room('r', ws)], NOW)
  expect(count(svg, /data-k="tie"/g)).toBe(0)
  expect(count(svg, /data-k="wait"/g)).toBe(1)
})

test('a tooltip says what a session waits for, and who waits for a star', () => {
  const ws = [w('a', 'work', { title: 'Розвідка' }), w('b', 'rest', { title: 'Звіт', waitsFor: [{ id: 'a', title: 'Розвідка' }] })]
  const out = galaxySvg([room('r', ws)], NOW)
  const tip = (id: string) => out.spots.find(s => s.id === id)!.tip
  expect(tip('b')).toBe('Звіт — чекає: Розвідка')
  expect(tip('a')).toBe('Розвідка — працює · чекають на нього: Звіт')
  expect(star(out.svg, 'a')).toContain('<title>Розвідка — працює · чекають на нього: Звіт</title>')
})

test('a working star held up by an MCP tool has a diamond going round it, far out; no other star has', () => {
  const mcp = { server: 'Claude_Browser', tool: 'browser_batch' }
  const ws = [w('a', 'work', { mcp }), w('b', 'work'), w('c', 'rest', { mcp }), w('d', 'work', { needsAnswer: true, mcp })]
  const { svg } = galaxySvg([room('r', ws), room('q', [w('x')])], NOW)
  const a = star(svg, 'a')
  expect(count(a, /data-k="mcp"/g)).toBe(1)
  expect(a).toMatch(/data-k="mcp"[^>]*fill="#A98BE0"/)
  expect(a).toContain('dur="7s"')
  // on a track well outside the arcs that turn round a working star
  const gap = (s: string) =>
    Number(s.match(/ r="([\d.]+)" fill="none" stroke="#A98BE0" stroke-width="0.6"/)![1]) - Number(s.match(/data-k="spin"[^>]* r="([\d.]+)"/)![1])
  expect(gap(a)).toBeGreaterThan(8)
  // the planets of a chosen system are open and their first orbit is near: the track comes in, and stays outside the arcs
  const open = gap(star(galaxySvg([room('r', ws), room('q', [w('x')])], NOW, 'a').svg, 'a'))
  expect(open).toBeGreaterThan(5)
  expect(open).toBeLessThan(gap(a))
  // the others are not held up by a tool: one that works freely, one that has stopped, one that waits for the person
  for (const id of ['b', 'c', 'd']) expect(star(svg, id)).not.toContain('data-k="mcp"')
})

test('a tooltip names the MCP server and tool a working star is held up by', () => {
  const out = galaxySvg([room('r', [w('a', 'work', { title: 'Розвідка', mcp: { server: 'Claude_Browser', tool: 'browser_batch' } })])], NOW)
  expect(out.spots[0]!.tip).toBe('Розвідка — працює · чекає MCP: Claude_Browser · browser_batch')
})

test('a stopped star whose background tasks are still going has the diamond of a wait going round it, and the colour of its list', () => {
  const tasks = [
    { id: 't1', kind: 'bash' as const, what: 'Run the stand', mcp: true },
    { id: 't2', kind: 'monitor' as const, what: 'Wait for the stand' },
  ]
  const ws = [w('a', 'rest', { tasks }), w('b', 'work', { tasks }), w('c', 'rest')]
  const out = galaxySvg([room('r', ws), room('q', [w('x')])], NOW)
  const a = star(out.svg, 'a')
  expect(a).toMatch(/data-k="task"[^>]*fill="#A98BE0"/)
  expect(a).toContain('dur="7s"')
  expect(a).toContain(`<circle cx="`) // the star itself
  expect(a).toContain(`r="`)
  expect(a).toContain(`fill="${GROUP_COLOR.task}"/>`)
  // a running one has its own work to do, and one with no tasks nothing to wait for
  for (const id of ['b', 'c']) expect(star(out.svg, id)).not.toContain('data-k="task"')
  // the wait is its state in the tooltip: the first task, with MCP when it goes to an MCP server, and how many more
  expect(out.spots.find(x => x.id === 'a')!.tip).toBe('chat a — чекає фонову задачу: Run the stand (MCP) і ще 1')
  // for a star that is in another list it is said after the state
  const asking = galaxySvg([room('r', [w('d', 'work', { tasks, needsAnswer: true })])], NOW)
  expect(asking.spots[0]!.tip).toBe('chat d — працює · чекає фонову задачу: Run the stand (MCP) і ще 1')
})

test('a pull request is a ring round the star, a change of state a flash, the chosen session a target', () => {
  const ws = [w('a', 'work', { prNumber: 7 }), w('b', 'wait', { prevKind: 'work', changedAt: NOW - 3000 }), w('c')]
  const { svg } = galaxySvg([room('r', ws)], NOW, 'c')
  expect(star(svg, 'a')).toContain('data-k="pr"')
  expect(star(svg, 'b')).toContain('data-k="flash"')
  expect(star(svg, 'c')).toContain('data-k="aim"')
  expect(star(svg, 'a')).not.toContain('data-k="aim"')
  // a change long ago is no flash
  expect(star(galaxySvg([room('r', [w('b', 'wait', { prevKind: 'work', changedAt: NOW - 3_600_000 })])], NOW).svg, 'b')).not.toContain('flash')
})

test('the more its context holds the bigger the system, the more it has read from the cache the bigger its cloud', () => {
  // beside another galaxy; alone, a star is half as big again
  const radius = (size: number, alone = false) => {
    const rooms = [room('r', [w('a', 'work', { size })]), ...(alone ? [] : [room('q', [w('b')])])]
    const s = star(galaxySvg(rooms, NOW).svg, 'a')
    return Number(s.match(/r="([\d.]+)" fill="#6FA8DC"\/>/)![1])
  }
  expect([0, 1, 2, 3, 4].map(s => radius(s))).toEqual([3.2, 4.5, 5.8, 7.1, 8.4])
  expect(radius(2, true)).toBe(8.7)
  const cloud = (haze: number) => star(galaxySvg([room('r', [w('a', 'work', { haze })])], NOW).svg, 'a').match(/<ellipse data-c="\d" [^>]*rx="([\d.]+)"/)?.[1]
  expect(cloud(0)).toBeUndefined()
  expect(Number(cloud(1))).toBeLessThan(Number(cloud(3)))
})

test('with one galaxy a plan is planets: done ones joined to the star, the one under way pulsing, the rest outlines', () => {
  const plan = [D, D, D, D, N, F, F]
  const { svg } = galaxySvg([room('r', [w('a', 'work', { plan })])], NOW)
  const s = star(svg, 'a')
  expect(count(s, /data-p="d"/g)).toBe(4)
  expect(count(s, /data-p="n"/g)).toBe(1)
  expect(count(s, /data-p="f"/g)).toBe(2)
  // a link from the star to each planet done, and none to the others
  expect(count(s, /<line /g)).toBe(4)
  // the one under way pulses: its radius moves
  expect(s).toContain('attributeName="r" values="2.8;4.8;2.8"')
})

test('the planet under way stops pulsing when its session is not working, and takes the colour of the reason', () => {
  const plan = [D, N, F]
  const frozen = (o: Partial<Worker>, kind: Kind = 'rest') => {
    const s = star(galaxySvg([room('r', [w('a', kind, { plan, ...o })])], NOW).svg, 'a')
    return s.match(/data-p="n"[^>]*/)![0]
  }
  const err = frozen({ error: { code: 'x', text: 't', at: NOW } })
  expect(err).toContain(`stroke="${GROUP_COLOR.err}"`)
  expect(frozen({ needsAnswer: true }, 'work')).toContain(`stroke="${GROUP_COLOR.ask}"`)
  expect(frozen({ waitsFor: [{ id: 'z', title: 'z' }] })).toContain(`stroke="${GROUP_COLOR.agent}"`)
  expect(frozen({})).toContain(`stroke="${REST_COLOR}"`)
  for (const o of [{ error: { code: 'x', text: 't', at: NOW } }, { needsAnswer: true }, {}]) {
    const s = star(galaxySvg([room('r', [w('a', 'rest', { plan, ...o })])], NOW).svg, 'a')
    expect(s).not.toContain('values="2.8;4.8;2.8"')
  }
  // while it works it does
  expect(star(galaxySvg([room('r', [w('a', 'work', { plan })])], NOW).svg, 'a')).toContain('values="2.8;4.8;2.8"')
})

test('a plan that is done all through closes its orbit; one that is not does not', () => {
  const closed = star(galaxySvg([room('r', [w('a', 'wait', { plan: [D, D, D] })])], NOW).svg, 'a')
  expect(closed).toContain('data-p="all"')
  expect(star(galaxySvg([room('r', [w('a', 'wait', { plan: [D, D, N] })])], NOW).svg, 'a')).not.toContain('data-p="all"')
})

test('a session with no plan has no planets, no marks, no orbit', () => {
  const s = star(galaxySvg([room('r', [w('a')])], NOW).svg, 'a')
  expect(s).not.toContain('data-p=')
  expect(count(s, /<line /g)).toBe(0)
})

test('twelve steps stand on three orbits, and more than twelve are not drawn', () => {
  const plan = Array.from({ length: 14 }, (_, i) => (i < 6 ? D : i === 6 ? N : F))
  const s = star(galaxySvg([room('r', [w('a', 'work', { plan })])], NOW).svg, 'a')
  expect(count(s, /data-p="[dnf]"/g)).toBe(12)
  expect(count(s, /<circle cx="[\d.]+" cy="[\d.]+" r="[\d.]+" fill="none" stroke="#8FA3CC" stroke-width="0.6"/g)).toBe(3)
})

test('planets stay off the next star: with a plan a star asks for more room', () => {
  const plan = Array.from({ length: 12 }, () => F)
  const ws = ['a', 'b', 'c', 'd'].map(id => w(id, 'work', { plan }))
  const out = galaxySvg([room('r', ws)], NOW)
  // the orbits of the 12 reach 17 + 24 + the planet and 2 beyond the star's radius (4.5 times one and a half); two stars
  // are at least this far apart (less a tenth)
  const need = (4.5 * 1.5 + 17 + 24 + 3.6 + 2) * 2 * 0.9
  const spots = out.spots
  let near = 0
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      if (Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.y - spots[j]!.y) < need) near++
    }
  }
  expect(near).toBeLessThanOrEqual(1)
})

test('with several galaxies a plan is a ring of marks round the star, one mark per step', () => {
  const plan = [D, D, N, F, F]
  const { svg } = galaxySvg([room('r1', [w('a', 'work', { plan })]), room('r2', [w('b')])], NOW)
  const s = star(svg, 'a')
  expect(s).not.toContain('<line ')
  expect(count(s, /data-p="/g)).toBe(3)
  // five marks in three paths: the number of arcs is the number of steps
  const arcs = (s.match(/ d="([^"]+)"/g) ?? []).join('').match(/A/g) ?? []
  expect(arcs.length).toBe(5)
  // a lone step is a whole turn
  const one = star(galaxySvg([room('r1', [w('a', 'work', { plan: [N] })]), room('r2', [w('b')])], NOW).svg, 'a')
  expect(count(one, /data-p="n"/g)).toBe(1)
})

test('sessions started by another are drawn beside it, and idle over a day they are only dim points', () => {
  const out = galaxySvg([room('r', [w('p'), w('k', 'work', { parentId: 'p' })], { homeCount: 3 })], NOW)
  const at = (id: string) => out.spots.find(s => s.id === id)!
  expect(Math.hypot(at('p').x - at('k').x, at('p').y - at('k').y)).toBeLessThan(80)
  expect(count(out.svg, /r="0.9" fill="#6B7488"/g)).toBe(3)
  expect(out.labels[0]!.sub).toBe('згаслих: 3')
})

test('the three kinds of project are three kinds of galaxy', () => {
  const arms = (type: Room['type']) => count(galaxySvg([room('r', [w('a')], { type })], NOW).svg, /stroke-dasharray="1 7"/g)
  expect(arms('project')).toBeGreaterThanOrEqual(2)
  expect(arms('remote')).toBe(2)
  expect(arms('cowork')).toBe(0)
})

test('the picture holds the pieces it was drawn with, and every colour it refers to is defined', () => {
  const ws = [w('a', 'work', { plan: [D, N, F], haze: 2, size: 3 }), w('b', 'rest', { error: { code: 'x', text: 't', at: NOW } })]
  const { svg } = galaxySvg([room('r', ws)], NOW)
  for (const tag of ['radialGradient', 'feGaussianBlur', 'feTurbulence', '<mask', '<animate']) expect(svg).toContain(tag)
  const defined = new Set([...svg.matchAll(/ id="([^"]+)"/g)].map(m => m[1]))
  const used = [...svg.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1])
  expect(used.length).toBeGreaterThan(0)
  for (const id of used) expect(defined.has(id)).toBe(true)
})

test('names and titles are written safely', () => {
  const { svg } = galaxySvg([room('a<b>&"c', [w('x"y', 'work', { title: '<script>alert(1)</script>' })])], NOW)
  expect(svg).not.toContain('<script>')
  expect(svg).toContain('&lt;script&gt;')
  // a project's name is not in the picture at all: the pane draws it as text, which it takes care of itself
  expect(svg).not.toContain('a&lt;b')
})

test('the worst case fits the limit: eight galaxies full of sessions with long plans', () => {
  const plan = Array.from({ length: 12 }, (_, i) => (i < 5 ? D : i === 5 ? N : F))
  const rooms = Array.from({ length: MAX_ROOMS + 2 }, (_, r) =>
    room(`g${r}`, Array.from({ length: 16 }, (_, i) => w(`s${r}-${i}`, i % 3 ? 'work' : 'wait', { plan, haze: 2, size: 3, prNumber: 4, needsAnswer: i % 5 === 0 })), { homeCount: 9 }),
  )
  const out = galaxySvg(rooms, NOW)
  expect(out.svg.length).toBeLessThanOrEqual(SIZE_LIMIT)
  expect(out.hiddenRooms).toBe(2)
  // and one galaxy with thirty sessions, in the detail view
  const one = galaxySvg([rooms[0]!], NOW)
  expect(one.svg.length).toBeLessThanOrEqual(SIZE_LIMIT)
  expect(one.spots.length).toBeGreaterThan(14)
})

test('a working system beats plainly: a halo round the star grows and fades; a quiet one is still', () => {
  const { svg } = galaxySvg([room('r', [w('k', 'work'), w('d', 'wait'), w('i', 'rest')])], NOW)
  const k = star(svg, 'k')
  expect(k).toContain('data-k="beat"')
  expect(k).toContain('dur="1.8s"')
  expect(k).toContain('repeatCount="indefinite"')
  expect(star(svg, 'd')).not.toContain('data-k="beat"')
  expect(star(svg, 'i')).not.toContain('<animate')
})

test('a working system has two white arcs turning round it, which no other state has; they stay between the star and the ring of its plan', () => {
  const plan = [D, N, F]
  const { svg } = galaxySvg([room('r', [w('k', 'work', { plan }), w('q', 'work', { needsAnswer: true }), w('d', 'wait'), w('i', 'rest')]), room('o', [w('x')])], NOW)
  const k = star(svg, 'k')
  expect(count(k, /data-k="spin"/g)).toBe(1)
  const spin = k.match(/<circle data-k="spin"[^>]*>/)![0]
  // white, whatever the star's colour is, and turning for good
  expect(spin).toContain('stroke="#FFFFFF"')
  expect(k).toContain('attributeName="transform" type="rotate"')
  expect(k).toMatch(/type="rotate" values="0 [\d.]+ [\d.]+;360 [\d.]+ [\d.]+" dur="1.2s" begin="-[\d.]+s" repeatCount="indefinite"/)
  // two arcs, with a gap after each: one dash and one gap are half the circumference
  const r = Number(spin.match(/ r="([\d.]+)"/)![1])
  const [dash, gap] = spin.match(/stroke-dasharray="([\d.]+) ([\d.]+)"/)!.slice(1).map(Number) as [number, number]
  expect(dash).toBeGreaterThan(0)
  expect(gap).toBeGreaterThan(0)
  expect(Math.abs((dash + gap) * 2 - 2 * Math.PI * r)).toBeLessThan(0.3)
  // inside the ring of the plan, which is 7 from the star's edge
  const ring = Number(k.match(/<path data-p="d" d="M[\d.]+ [\d.]+A([\d.]+) /)![1])
  expect(r).toBeLessThan(ring)
  // the others do not turn: a question, a finished session, a resting one
  for (const id of ['q', 'd', 'i']) expect(star(svg, id)).not.toContain('data-k="spin"')
})

test('pressing a system opens its planets even among several galaxies; the others keep their rings', () => {
  const plan = [D, D, N, F]
  const rooms = [room('r1', [w('a', 'work', { plan }), w('c', 'work', { plan })]), room('r2', [w('b')])]
  const out = galaxySvg(rooms, NOW, 'a').svg
  // the chosen one: planets and links; the other: a ring of marks
  expect(star(out, 'a')).toContain('<line ')
  expect(count(star(out, 'a'), /data-p="[dnf]"/g)).toBe(4)
  expect(star(out, 'c')).not.toContain('<line ')
  // nothing chosen: rings all round
  expect(star(galaxySvg(rooms, NOW).svg, 'a')).not.toContain('<line ')
  // the chosen one is drawn last, over the rest
  expect(out.indexOf('<g data-s="a"')).toBeGreaterThan(out.indexOf('<g data-s="c"'))
  expect(out.indexOf('<g data-s="a"')).toBeGreaterThan(out.indexOf('<g data-s="b"'))
})

test('a picture drawn again goes on from where the beat was: each cycle starts in the past by as much as the clock has run', () => {
  const beat = (at: number) => {
    const s = star(galaxySvg([room('r', [w('k', 'work')])], at).svg, 'k')
    return s.match(/begin="(-[\d.]+)s"/)![1]
  }
  // the same moment, the same picture
  expect(beat(NOW)).toBe(beat(NOW))
  // a second later the cycle is a second further on
  const diff = (Number(beat(NOW + 1000).slice(1)) - Number(beat(NOW).slice(1)) + 1.8) % 1.8
  expect(Math.abs(diff - 1)).toBeLessThan(0.15)
  // never a start in the future, and never beyond one cycle
  for (const t of [0, 1234, 99999, NOW]) expect(Number(beat(t).slice(1))).toBeLessThan(1.8)
})

test('a picture drawn again with nothing changed is the very same one (it is drawn at every step of the scroll), a changed one is new', () => {
  const same = steady<ReturnType<typeof galaxySvg>>()
  const rooms = [room('r', [w('k', 'work'), w('q', 'work', { needsAnswer: true, askedAt: NOW - 60_000 })])]
  const first = same(galaxySvg(rooms, NOW))
  // seconds later only the start of each cycle has moved: the same picture, byte for byte
  for (const dt of [1000, 2500, 7000]) expect(same(galaxySvg(rooms, NOW + dt))).toBe(first)
  // a session that changed is a new picture
  const other = same(galaxySvg([room('r', [w('k', 'work'), w('q', 'rest')])], NOW + 8000))
  expect(other).not.toBe(first)
  expect(other.svg).not.toBe(first.svg)
})

test('the names are the own light text of the pane on the dark picture, level with the top of each galaxy', () => {
  const out = galaxySvg([room('alpha', [w('a')]), room('beta', [w('b')])], NOW)
  expect(out.labels.map(l => l.name)).toEqual(['alpha', 'beta'])
  expect(out.labels.every(l => l.dark === true)).toBe(true)
  // nothing of the name is drawn in the picture: the pane draws it, and what is pressed is what is seen
  expect(out.svg).not.toContain('<text')
  expect(out.svg).not.toContain('alpha')
  const [a, b] = out.labels
  expect(a!.y).toBe(b!.y)
  expect(b!.x).toBeGreaterThan(a!.x)
})

test('a star carries its session name as a tooltip, over the whole system and not only the painted pixels', () => {
  const { svg } = galaxySvg([room('r', [w('a', 'work', { title: 'Моя сесія', plan: [D, N, F] })])], NOW)
  const s = star(svg, 'a')
  expect(s).toContain('<title>Моя сесія — працює</title>')
  expect(s).toMatch(/<circle [^>]*fill="none" pointer-events="all"\/>/)
})

test('a session started by another is tied to it by a thread, in one galaxy or across two, and not when the parent is off the screen', () => {
  const one = galaxySvg([room('r', [w('p'), w('k', 'work', { parentId: 'p' }), w('l', 'work', { parentId: 'k' })])], NOW).svg
  expect(count(one, /data-k="tie"/g)).toBe(2)

  const across = galaxySvg([room('r1', [w('p')]), room('r2', [w('k', 'work', { parentId: 'p' })])], NOW).svg
  expect(count(across, /data-k="tie"/g)).toBe(1)

  expect(count(galaxySvg([room('r', [w('a'), w('b')])], NOW).svg, /data-k="tie"/g)).toBe(0)
  expect(count(galaxySvg([room('r', [w('k', 'work', { parentId: 'gone' })])], NOW).svg, /data-k="tie"/g)).toBe(0)
})
