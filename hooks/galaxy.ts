import type { PlanStatus, Room, Worker } from '../types'
import { GROUP_COLOR, groupKeyOf, HOME_MS, WORD } from './data'
import { decisionText, mcpName, tasksText, waitsText } from './detail'
import { MAX_ROOMS, SIZE_LIMIT, TRANSITION_MS } from './floor'
import type { Label, Scene, Spot } from './floor'
import { esc, hash, n1 } from './iso'

/**
 * The whole work as a night sky: a galaxy per project, a star per session, a planet per step of the session's plan.
 *
 *  - the star's colour is the colour of the list the session stands in; its size is how much its context holds (the more
 *    it holds, the bigger the system, planets and all); the cloud round it is how much it has read from the cache;
 *  - a step done is a planet joined to its star, the step under way is a planet that pulses (while the session works),
 *    a step to come is an outline;
 *  - with several galaxies on the screen a plan is a ring of marks round the star, with one galaxy it is the planets.
 *
 * Where a star stands depends on its id alone, not on the order of the list, so the picture does not move between polls.
 */

const W = 760
const PAD = 14
const HEAD = 38 // the galaxy's name and what is under it
const OVER_H = 280
const DETAIL_H = 560
const PER_RING = 5
const MAX_PLANETS = 12
const PLANET = 3.6 // the radius of a planet
/** The radius of the i-th orbit (from 0) round a star of radius r. */
const orbit = (r: number, i: number) => r + 17 + i * 12
const MIN_GAP = 38 // stars are pressed through a button over them: not closer than this, in scene px
const SWIRL = 2.6
const GOLD = 0.6180339887

export const REST_COLOR = '#AEB7C8'
const AMBER = '#FFC46B'
const FUTURE = '#8FA3CC'
const PURPLE = GROUP_COLOR.agent
const PINK = GROUP_COLOR.decide
const TINTS = ['#BFD4FF', '#F2B6D3', '#FFD9A0']
// star colours by temperature, for the backdrop
const TEMP = ['#BFD4FF', '#DCE8FF', '#FFFFFF', '#FFF3D6', '#FFDDAA', '#FFBE8C']

/** The same numbers every time: a picture that moves between polls would blink. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

type Cell = { room: Room; x: number; y: number; w: number; h: number }
type Shape = { cx: number; cy: number; rx: number; ry: number; rot: number; arms: number; tint: number }
type Star = { w: Worker; x: number; y: number; r: number; reach: number; color: string }

/** A star is half as big again when it is the only galaxy: there are planets to carry. */
const starRadius = (w: Worker, detail: boolean) => (3.2 + (w.size ?? 1) * 1.3) * (detail ? 1.5 : 1)
const planOf = (w: Worker): PlanStatus[] => (w.plan ?? []).slice(0, MAX_PLANETS)

/** How far from its star a session's marks reach: what other stars must stay clear of. */
function reachOf(w: Worker, detail: boolean): number {
  const r = starRadius(w, detail)
  const n = planOf(w).length
  if (detail) return n > 0 ? orbit(r, Math.ceil(n / PER_RING) - 1) + PLANET + 2 : r + 8
  return n > 0 ? r + 9 : r + 6
}

function shapeOf(cell: Cell): Shape {
  const h0 = hash(cell.room.key)
  const far = cell.room.type === 'remote' ? 0.8 : 1
  const rx = cell.w * 0.43 * far
  const ry = Math.min((cell.h - HEAD) * 0.42 * far, rx * (0.55 + ((h0 >>> 5) % 25) / 100))
  return {
    cx: cell.x + cell.w / 2,
    cy: cell.y + HEAD + (cell.h - HEAD) / 2,
    rx,
    ry,
    rot: (((h0 % 41) - 20) * Math.PI) / 180,
    arms: cell.room.type === 'cowork' ? 0 : cell.room.type === 'remote' ? 2 : 2 + ((h0 >>> 3) % 2),
    tint: (h0 >>> 7) % TINTS.length,
  }
}

const turn = (sh: Shape, x: number, y: number): [number, number] => [
  sh.cx + x * Math.cos(sh.rot) - y * Math.sin(sh.rot),
  sh.cy + x * Math.sin(sh.rot) + y * Math.cos(sh.rot),
]

/** The k-th place to try for a session: on its own arm, further out each time (or anywhere, in a galaxy with no arms). */
function tryOnDisk(sh: Shape, h: number, k: number): [number, number] {
  const f = ((h >>> 4) % 1000) / 1000
  const t = 0.3 + ((f + k * GOLD) % 1) * 0.62
  let th: number
  if (sh.arms > 0) {
    const jit = (((h >>> 14) % 100) / 100 - 0.5) * 0.35
    th = (((h >>> 2) % sh.arms) * 2 * Math.PI) / sh.arms + SWIRL * t + jit
  } else {
    th = ((((h >>> 9) % 1000) / 1000 + k * GOLD) % 1) * 2 * Math.PI
  }
  return turn(sh, sh.rx * t * Math.cos(th), sh.ry * t * Math.sin(th))
}

/** The k-th place to try for a session started by another one: round it, further out each time. */
function tryAround(p: Star, h: number, r: number, k: number): [number, number] {
  const a = (((h >>> 3) % 628) / 100 + k * 2.4) % (2 * Math.PI)
  const d = p.reach + r + 8 + (k >> 2) * 4
  return [p.x + d * Math.cos(a), p.y + d * Math.sin(a)]
}

/** The stars of one galaxy: parents first, then the sessions they started beside them. */
function place(cell: Cell, workers: Worker[], detail: boolean): Star[] {
  const sh = shapeOf(cell)
  const here = new Set(workers.map(w => w.id))
  const order = (a: Worker, b: Worker) => hash(a.id) - hash(b.id) || (a.id < b.id ? -1 : 1)
  const roots = workers.filter(w => !w.parentId || !here.has(w.parentId)).sort(order)
  const kids = workers.filter(w => w.parentId && here.has(w.parentId)).sort(order)
  const placed: Star[] = []
  const inside = (x: number, y: number) =>
    x >= cell.x + 14 && x <= cell.x + cell.w - 14 && y >= cell.y + HEAD + 8 && y <= cell.y + cell.h - 12

  for (const w of [...roots, ...kids]) {
    const h = hash(w.id)
    const r = starRadius(w, detail)
    const reach = reachOf(w, detail)
    const parent = placed.find(p => p.w.id === w.parentId)
    // how far the spot is from standing clear of the others (>= 0 is clear), and whether it is on the card at all
    const slack = (x: number, y: number) => {
      let s = inside(x, y) ? Infinity : -50
      for (const p of placed) s = Math.min(s, Math.hypot(x - p.x, y - p.y) - Math.max(MIN_GAP, (reach + p.reach) * 0.9))
      return s
    }
    let best: [number, number] = [sh.cx, sh.cy]
    let bestSlack = -Infinity
    for (let k = 0; k < 48; k++) {
      const at = parent ? tryAround(parent, h, r, k) : tryOnDisk(sh, h, k)
      const s = slack(at[0], at[1])
      if (s > bestSlack) {
        best = at
        bestSlack = s
        if (s >= 0) break
      }
    }
    const key = groupKeyOf(w)
    placed.push({ w, x: best[0], y: best[1], r, reach, color: key ? GROUP_COLOR[key] : REST_COLOR })
  }
  return placed
}

// ---- drawing ----

type Ctx = {
  now: number
  selectedId: string
  detail: boolean
  glow: (c: string) => string
  /** the titles of the sessions that wait for a star, by its id: only the stars that are waited for are in it */
  by: Map<string, string[]>
}

const MARK_GAP = 3.5 // a star that waits and is waited for has its dashed ring this far outside the solid one

/**
 * The radius of the ring that marks a star that is waited for. It lies outside what is already round the star: the turning
 * arcs of a working one (r + 3.5) and the ring of the plan (r + 7), when the plan is drawn as a ring.
 */
const markOf = (s: Star, c: Ctx): number => s.r + (planOf(s.w).length > 0 && !(c.detail || s.w.id === c.selectedId) ? 11 : 6)
/** The radius of the ring of a star that waits: outside the solid one when the star is waited for too. */
const waitMarkOf = (s: Star, c: Ctx): number => markOf(s, c) + (c.by.has(s.w.id) ? MARK_GAP : 0)

const arc = (x: number, y: number, rr: number, a0: number, a1: number) =>
  `M${n1(x + rr * Math.cos(a0))} ${n1(y + rr * Math.sin(a0))}A${n1(rr)} ${n1(rr)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${n1(x + rr * Math.cos(a1))} ${n1(y + rr * Math.sin(a1))}`

/**
 * The time of the picture being drawn, in seconds. A drawn picture starts its animations from nothing; to make a new
 * one go on from where the old one was (a press on a star draws it again), each cycle is started in the past, by as
 * much as the clock says it has run: the beat then goes on, not back to its start.
 */
let clock = 0
const lasting = (dur: string) => parseFloat(dur)
const phase = (dur: string, begin: number) => n1((clock + begin) % lasting(dur))

const pulse = (attr: string, values: string, dur: string, begin: number) =>
  `<animate attributeName="${attr}" values="${values}" dur="${dur}" begin="-${phase(dur, begin)}s" repeatCount="indefinite"/>`

/** The plan as a ring of marks round the star: done bright, the one under way amber (pulsing while it works), to come dim. */
function ring(s: Star, running: boolean, begin: number): string {
  const plan = planOf(s.w)
  const n = plan.length
  const rr = s.r + 7
  const gap = n > 1 ? 0.2 : 0
  const seg = (2 * Math.PI) / n
  const paths: Record<'d' | 'n' | 'f', string> = { d: '', n: '', f: '' }
  plan.forEach((st, i) => {
    const key = st === 'completed' ? 'd' : st === 'in_progress' ? 'n' : 'f'
    const a0 = -Math.PI / 2 + i * seg + gap / 2
    const a1 = -Math.PI / 2 + (i + 1) * seg - gap / 2
    // one full turn cannot be one arc (its ends meet): two halves
    paths[key] += n === 1 ? arc(s.x, s.y, rr, a0, a0 + Math.PI) + arc(s.x, s.y, rr, a0 + Math.PI, a0 + 2 * Math.PI - 0.001) : arc(s.x, s.y, rr, a0, a1)
  })
  const nowColor = running ? AMBER : s.color
  return (
    (paths.d ? `<path data-p="d" d="${paths.d}" fill="none" stroke="${s.color}" stroke-width="2.2" opacity="0.9"/>` : '') +
    (paths.n
      ? `<path data-p="n" d="${paths.n}" fill="none" stroke="${nowColor}" stroke-width="2.6"${running ? '' : ' opacity="0.8"'}>${running ? pulse('opacity', '0.35;1;0.35', '2.4s', begin) : ''}</path>`
      : '') +
    (paths.f ? `<path data-p="f" d="${paths.f}" fill="none" stroke="${FUTURE}" stroke-width="1.2" stroke-dasharray="1.5 2" opacity="0.65"/>` : '')
  )
}

/** The plan as planets on orbits round the star. */
function planets(s: Star, running: boolean, begin: number): string {
  const plan = planOf(s.w)
  const n = plan.length
  const phase = (hash(s.w.id) % 628) / 100
  const rings = Math.ceil(n / PER_RING)
  const allDone = plan.every(p => p === 'completed')
  let orbits = ''
  for (let i = 0; i < rings; i++) {
    const ro = orbit(s.r, i)
    orbits += allDone
      ? `<circle data-p="all" cx="${n1(s.x)}" cy="${n1(s.y)}" r="${n1(ro)}" fill="none" stroke="${s.color}" stroke-width="1.2" opacity="0.6"/>`
      : `<circle cx="${n1(s.x)}" cy="${n1(s.y)}" r="${n1(ro)}" fill="none" stroke="${FUTURE}" stroke-width="0.6" opacity="0.18"/>`
  }
  let dots = ''
  plan.forEach((st, j) => {
    const i = Math.floor(j / PER_RING)
    const onRing = Math.min(PER_RING, n - i * PER_RING)
    const ro = orbit(s.r, i)
    const a = phase + i * 0.6 + (2 * Math.PI * (j % PER_RING)) / onRing
    const px = n1(s.x + ro * Math.cos(a))
    const py = n1(s.y + ro * Math.sin(a))
    if (st === 'completed') {
      dots +=
        `<line x1="${n1(s.x)}" y1="${n1(s.y)}" x2="${px}" y2="${py}" stroke="${s.color}" stroke-width="0.9" opacity="0.55"/>` +
        `<circle data-p="d" cx="${px}" cy="${py}" r="${PLANET}" fill="${s.color}"/>`
    } else if (st === 'in_progress') {
      dots += running
        ? `<circle cx="${px}" cy="${py}" r="12" fill="url(#g${AMBER.slice(1)})" opacity="0.6">${pulse('opacity', '0.25;0.8;0.25', '2.4s', begin)}</circle>` +
          `<circle data-p="n" cx="${px}" cy="${py}" r="${PLANET}" fill="${AMBER}">${pulse('r', `${PLANET - 0.8};${PLANET + 1.2};${PLANET - 0.8}`, '2.4s', begin)}</circle>`
        : // not pulsing: nothing is moving it on, and the colour says why
          `<circle data-p="n" cx="${px}" cy="${py}" r="${PLANET}" fill="none" stroke="${s.color}" stroke-width="1.6"/>` +
          `<circle cx="${px}" cy="${py}" r="1.1" fill="${s.color}" opacity="0.6"/>`
    } else {
      dots += `<circle data-p="f" cx="${px}" cy="${py}" r="${PLANET}" fill="none" stroke="${FUTURE}" stroke-width="1.1" stroke-dasharray="2.4 2.4" opacity="0.8"/>`
    }
  })
  return orbits + dots
}

// no time in the tooltip: it would change the drawing every minute, and a changed drawing is drawn afresh (it blinks)
const tipOf = (w: Worker, by: string[] = []): string => {
  const key = groupKeyOf(w)
  const waits = key === 'agent' ? waitsText(w) : undefined
  const named = by.length ? ` · чекають на нього: ${by[0]}${by.length > 1 ? ` і ще ${by.length - 1}` : ''}` : ''
  const tool = w.mcp && key === 'work' ? ` · чекає MCP: ${mcpName(w.mcp)}` : ''
  // for a chat in the list of those that wait for a task, the wait is its state; for any other (it also waits for the
  // person, say) it is a thing said after
  const state = waits
    ? `чекає: ${waits}`
    : key === 'task'
      ? `чекає фонову задачу: ${tasksText(w)}`
      : key === 'decide' && w.decision
        ? `чекає рішення: ${decisionText(w.decision)}`
        : WORD[w.kind]
  const task = w.tasks?.length && key !== 'task' ? ` · чекає фонову задачу: ${tasksText(w)}` : ''
  return `${w.title} — ${state}${w.parentId ? ' (стажер)' : ''}${tool}${task}${named}`
}

function star(s: Star, c: Ctx): string {
  const { w } = s
  const key = groupKeyOf(w)
  const running = key === 'work'
  const x = n1(s.x)
  const y = n1(s.y)
  const r = s.r
  const col = s.color
  const begin = (hash(w.id) % 24) / 10
  const haze = w.haze ?? 0
  // idle sessions fade the longer they stand idle
  const tip = tipOf(w, c.by.get(w.id))
  const fade = key === undefined ? 0.5 + 0.5 * Math.max(0, 1 - (c.now - w.activityAt) / HOME_MS) : 1
  // the whole system answers the pointer, not only the painted pixels: the glow and the gaps between the planets are
  // otherwise not hit, and the tooltip would show only over the star itself
  let g = `<circle cx="${x}" cy="${y}" r="${n1(Math.max(s.reach + 2, r * 3))}" fill="none" pointer-events="all"/>`

  if (haze > 0) {
    const e = r + 12 + haze * 7
    g += `<ellipse data-c="${haze}" cx="${x}" cy="${y}" rx="${n1(e)}" ry="${n1(e * 0.7)}" fill="${c.glow(col)}" opacity="${n1(0.16 + haze * 0.05)}" transform="rotate(${Math.round(((hash(w.id) >>> 5) % 90) - 45)} ${x} ${y})"/>`
  }
  // a working star's glow is steady and a little brighter: the sign that it works is the turning ring below, and a glow
  // that also swelled would only be one more thing moving, in the same blue as the sky
  g += `<circle cx="${x}" cy="${y}" r="${n1(r * 4.2)}" fill="${c.glow(col)}" opacity="${running ? 0.75 : 0.6}"/>`

  if (key === 'err') {
    // a ragged flash: eight points, long and short
    let pts = ''
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8 - Math.PI / 2
      const d = i % 2 === 0 ? r * (i % 4 === 0 ? 3.4 : 2.6) : r * 1.1
      pts += `${n1(s.x + d * Math.cos(a))},${n1(s.y + d * Math.sin(a))} `
    }
    g += `<polygon data-k="err" points="${pts.trim()}" fill="${col}" opacity="0.9"/>`
  } else if (key === 'ask' || key === 'decide') {
    // a beacon: a ring that spreads and fades, wider the longer the person has been kept waiting (a decision's is pink, and
    // the whole system is lit besides: see `spotlight`)
    // in coarse steps: a drawing that changes every few seconds is drawn afresh every time (it blinks)
    const mins = w.askedAt ? Math.max(0, (c.now - w.askedAt) / 60000) : 0
    const max = n1(r + 14 + Math.min(18, Math.floor(mins / 6) * 3))
    g +=
      `<circle data-k="${key}" cx="${x}" cy="${y}" r="${n1(r + 3)}" fill="none" stroke="${col}" stroke-width="1.4">` +
      pulse('r', `${n1(r + 3)};${max}`, '2.4s', begin) +
      pulse('opacity', '0.9;0', '2.4s', begin) +
      '</circle>'
  } else {
    g += `<path d="M${n1(s.x - r * 2.8)} ${y}H${n1(s.x + r * 2.8)}M${x} ${n1(s.y - r * 2.8)}V${n1(s.y + r * 2.8)}" stroke="${col}" stroke-width="0.7" opacity="0.55"/>`
  }
  if (running) {
    g +=
      `<circle data-k="beat" cx="${x}" cy="${y}" r="${n1(r * 1.4)}" fill="${col}" opacity="0.5">` +
      pulse('r', `${n1(r * 1.2)};${n1(r * 2.8)};${n1(r * 1.2)}`, '1.8s', begin) +
      pulse('opacity', '0.6;0.05;0.6', '1.8s', begin) +
      '</circle>'
    // the sign that work is going on: two white arcs turning round the star. White, not the star's blue: a bright mark on a
    // dark sky reads whatever the hue, and a turn is seen sooner than a glow that swells in place. The arcs lie between the
    // star and the ring of the plan (r + 7), on a faint track of the star's colour
    const sr = r + 3.5
    const len = 2 * Math.PI * sr
    const dash = len * 0.28
    g +=
      `<circle cx="${x}" cy="${y}" r="${n1(sr)}" fill="none" stroke="${col}" stroke-width="1" opacity="0.35"/>` +
      `<circle data-k="spin" cx="${x}" cy="${y}" r="${n1(sr)}" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="${n1(dash)} ${n1(len / 2 - dash)}">` +
      `<animateTransform attributeName="transform" type="rotate" values="0 ${x} ${y};360 ${x} ${y}" dur="1.2s" begin="-${phase('1.2s', begin)}s" repeatCount="indefinite"/>` +
      '</circle>'
  }
  // held up: a running chat by an MCP tool that has not answered, a stopped one by what it started in the background and
  // is still waiting for (a command, a monitor). A small diamond in the colour of a wait goes slowly round, far out on a
  // faint track: there is no star to be joined to, so no line. Nearer the star when the planets are open (their first
  // orbit is at r + 17)
  if (running ? w.mcp : w.tasks?.length) {
    const mr = r + (c.detail || w.id === c.selectedId ? 10.5 : 15)
    const dx = n1(s.x + mr)
    g +=
      `<circle cx="${x}" cy="${y}" r="${n1(mr)}" fill="none" stroke="${PURPLE}" stroke-width="0.6" opacity="0.3"/>` +
      `<path data-k="${running ? 'mcp' : 'task'}" d="M${dx} ${n1(s.y - 3)}L${n1(s.x + mr + 3)} ${y}L${dx} ${n1(s.y + 3)}L${n1(s.x + mr - 3)} ${y}Z" fill="${PURPLE}" stroke="#0A1129" stroke-width="0.8">` +
      `<animateTransform attributeName="transform" type="rotate" values="0 ${x} ${y};360 ${x} ${y}" dur="7s" begin="-${phase('7s', begin)}s" repeatCount="indefinite"/></path>`
  }
  g += `<circle cx="${x}" cy="${y}" r="${n1(r)}" fill="${col}"/><circle cx="${x}" cy="${y}" r="${n1(r * (running ? 0.62 : 0.5))}" fill="#FFFFFF" opacity="${running ? 1 : 0.9}"/>`

  // in a wait: a solid ring on the star that is waited for, a dashed one that turns slowly on the star that waits
  if (c.by.has(w.id)) {
    g += `<circle data-k="awaited" cx="${x}" cy="${y}" r="${n1(markOf(s, c))}" fill="none" stroke="${PURPLE}" stroke-width="1.8" opacity="0.95"/>`
  }
  if (key === 'agent') {
    const rw = waitMarkOf(s, c)
    const len = 2 * Math.PI * rw
    // a whole number of dashes with their gaps go round the ring, so that it has no seam
    const half = +(len / Math.max(6, Math.round(len / 8.6)) / 2).toFixed(2)
    g +=
      `<circle data-k="waiting" cx="${x}" cy="${y}" r="${n1(rw)}" fill="none" stroke="${PURPLE}" stroke-width="1.4" stroke-dasharray="${half} ${half}">` +
      `<animateTransform attributeName="transform" type="rotate" values="360 ${x} ${y};0 ${x} ${y}" dur="6s" begin="-${phase('6s', begin)}s" repeatCount="indefinite"/>` +
      '</circle>'
  }

  if (w.prNumber) {
    g += `<ellipse data-k="pr" cx="${x}" cy="${y}" rx="${n1(r * 2.4)}" ry="${n1(r * 0.85)}" fill="none" stroke="#DCE8FF" stroke-width="1" opacity="0.7" transform="rotate(-24 ${x} ${y})"/>`
  }
  if (w.prevKind !== undefined && c.now - w.changedAt < TRANSITION_MS) {
    g +=
      `<circle data-k="flash" cx="${x}" cy="${y}" r="${n1(r)}" fill="none" stroke="#FFFFFF" stroke-width="2">` +
      `<animate attributeName="r" values="${n1(r)};${n1(r * 6)}" dur="1.6s" repeatCount="3"/>` +
      `<animate attributeName="opacity" values="0.9;0" dur="1.6s" repeatCount="3"/></circle>`
  }

  if (planOf(w).length > 0) g += c.detail || w.id === c.selectedId ? planets(s, running, begin) : ring(s, running, begin)
  if (w.id === c.selectedId) {
    g += `<circle data-k="aim" cx="${x}" cy="${y}" r="${n1(s.reach + 3)}" fill="none" stroke="#FFFFFF" stroke-width="1" stroke-dasharray="3 3" opacity="0.85"/>`
  }
  return `<g data-s="${esc(w.id)}" opacity="${n1(fade)}"><title>${esc(tip)}</title>${g}</g>`
}

/** How far a lit system reaches: what its star, its planets and the ring of the plan lie within, and a little more. */
const lightOf = (s: Star): number => n1(Math.max(s.reach + 14, s.r * 5, 36))

/**
 * The whole system of a star that waits on a decision lit as by a spotlight: a soft pink disc that slowly breathes, held in
 * a dashed rim. Drawn under every star, so that a lit system never covers one beside it. Seen from afar, it is what says
 * "a decision is wanted here" before a name can be read.
 */
function spotlight(s: Star, begin: number): string {
  const rr = lightOf(s)
  const x = n1(s.x)
  const y = n1(s.y)
  return (
    `<g data-k="spot">` +
    `<circle cx="${x}" cy="${y}" r="${rr}" fill="${PINK}" opacity="0.14">${pulse('opacity', '0.08;0.24;0.08', '3s', begin)}</circle>` +
    `<circle cx="${x}" cy="${y}" r="${rr}" fill="none" stroke="${PINK}" stroke-width="1" stroke-dasharray="5 4" opacity="0.8"/>` +
    '</g>'
  )
}

/** The badge over a lit system: a pink pill that says what is wanted. Drawn over everything, so that no star covers it. */
function badge(s: Star): string {
  const bw = 78
  const cx = n1(Math.min(W - bw / 2 - 4, Math.max(bw / 2 + 4, s.x)))
  const cy = n1(Math.max(11, s.y - lightOf(s) - 9))
  return (
    `<g data-k="badge"><rect x="${n1(cx - bw / 2)}" y="${n1(cy - 7)}" width="${bw}" height="14" rx="7" fill="${PINK}"/>` +
    `<text x="${cx}" y="${n1(cy + 3.2)}" text-anchor="middle" font-size="9" font-weight="bold" fill="#3B0F28">чекає рішення</text></g>`
  )
}

/**
 * A dashed line that flows from (x0, y0) to (x1, y1) and ends in an arrow head, whose tip is at (x1, y1): the direction of
 * a wait. The head is shorter when the gap is; with no room for either, nothing is drawn (the rings already say it).
 */
function stream(x0: number, y0: number, x1: number, y1: number): string {
  const d = Math.hypot(x1 - x0, y1 - y0)
  if (d < 3) return ''
  const ux = (x1 - x0) / d
  const uy = (y1 - y0) / d
  const len = Math.min(6, d * 0.6)
  const bx = x1 - ux * len
  const by = y1 - uy * len
  const hw = len / 2
  return (
    (d > len + 2
      ? `<path data-k="wait" d="M${n1(x0)} ${n1(y0)}L${n1(bx)} ${n1(by)}" fill="none" stroke="${PURPLE}" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="6 5" opacity="0.9">` +
        `<animate attributeName="stroke-dashoffset" values="11;0" dur="0.9s" begin="-${phase('0.9s', 0)}s" repeatCount="indefinite"/></path>`
      : '') +
    `<path data-k="wait-head" d="M${n1(x1)} ${n1(y1)}L${n1(bx - uy * hw)} ${n1(by + ux * hw)}L${n1(bx + uy * hw)} ${n1(by - ux * hw)}Z" fill="${PURPLE}" opacity="0.9"/>`
  )
}

/**
 * The lines from a session to each of the ones it waits for, from the ring of the one to the ring of the other, with an
 * arrow at the end that is waited for. What is not on the screen is a short arrow out of the star, the one for all of it.
 */
function waits(s: Star, byId: Map<string, Star>, c: Ctx): string {
  if (groupKeyOf(s.w) !== 'agent') return ''
  const from = waitMarkOf(s, c)
  const seen = new Set<Star>()
  let out = ''
  let hidden = false
  for (const x of s.w.waitsFor ?? []) {
    const t = byId.get(x.id)
    if (!t) hidden = true
    if (!t || t === s || seen.has(t)) continue
    seen.add(t)
    const d = Math.hypot(t.x - s.x, t.y - s.y)
    const to = markOf(t, c)
    // the rings touch: they say it already
    if (d - from - to < 3) continue
    const ux = (t.x - s.x) / d
    const uy = (t.y - s.y) / d
    out += stream(s.x + ux * from, s.y + uy * from, t.x - ux * to, t.y - uy * to)
  }
  if (hidden) {
    const a = (hash(s.w.id) % 628) / 100
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    out += stream(s.x + ux * from, s.y + uy * from, s.x + ux * (from + 22), s.y + uy * (from + 22))
  }
  return out
}

/** Whether the star `a` is one that waits for the star `b`. */
const waitsFor = (a: Star, b: Star): boolean => groupKeyOf(a.w) === 'agent' && !!a.w.waitsFor?.some(x => x.id === b.w.id)

/**
 * A thread from a system to the one that started it: the parent and the child are tied, in one galaxy or across two.
 * It runs between the stars' edges, not through them, and is not drawn when the parent is not on the screen, nor when one
 * of the two waits for the other (the line of the wait is then the one drawn between them).
 */
function tie(s: Star, byId: Map<string, Star>): string {
  const p = s.w.parentId ? byId.get(s.w.parentId) : undefined
  if (!p || p === s) return ''
  if (waitsFor(s, p) || waitsFor(p, s)) return ''
  const d = Math.hypot(s.x - p.x, s.y - p.y)
  const a = p.r * 1.6
  const b = s.r * 1.6
  if (d <= a + b + 2) return ''
  const ux = (s.x - p.x) / d
  const uy = (s.y - p.y) / d
  return `<line data-k="tie" x1="${n1(p.x + ux * a)}" y1="${n1(p.y + uy * a)}" x2="${n1(s.x - ux * b)}" y2="${n1(s.y - uy * b)}" stroke="#DCE8FF" stroke-width="1" stroke-linecap="round" opacity="0.45"/>`
}

/** The galaxy itself: a glowing disk, its arms and dust, a bright core, and a dim point for each session gone home. */
function backdropOf(cell: Cell, sh: Shape, defs: Set<string>): string {
  const h0 = hash(cell.room.key)
  const tint = TINTS[sh.tint] as string
  defs.add(`d${sh.tint}`)
  const deg = n1((sh.rot * 180) / Math.PI)
  let out = `<ellipse cx="${n1(sh.cx)}" cy="${n1(sh.cy)}" rx="${n1(sh.rx * 1.05)}" ry="${n1(sh.ry * 1.05)}" fill="url(#d${sh.tint})" transform="rotate(${deg} ${n1(sh.cx)} ${n1(sh.cy)})"/>`
  let local = ''
  let dust = ''
  if (sh.arms > 0) {
    for (let a = 0; a < sh.arms; a++) {
      let d = ''
      for (let i = 0; i <= 9; i++) {
        const t = 0.1 + i * 0.1
        const th = (a * 2 * Math.PI) / sh.arms + SWIRL * t
        d += `${i === 0 ? 'M' : 'L'}${n1(sh.rx * t * Math.cos(th))} ${n1(sh.ry * t * Math.sin(th))}`
      }
      local += `<path d="${d}" fill="none" stroke="${tint}" stroke-width="${n1(sh.rx / 11)}" stroke-linecap="round" opacity="0.3"/>`
      dust += `<path d="${d}" fill="none" stroke="${tint}" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 7" opacity="0.65"/>`
    }
  } else {
    // no arms: a few soft clouds
    const r = rng(h0)
    for (let i = 0; i < 4; i++) {
      local += `<ellipse cx="${n1((r() - 0.5) * sh.rx)}" cy="${n1((r() - 0.5) * sh.ry)}" rx="${n1(sh.rx * (0.25 + r() * 0.2))}" ry="${n1(sh.ry * (0.2 + r() * 0.2))}" fill="${tint}" opacity="0.14"/>`
    }
  }
  out +=
    `<g transform="translate(${n1(sh.cx)} ${n1(sh.cy)}) rotate(${deg})"><g filter="url(#haze)">${local}</g>${dust}</g>` +
    `<circle cx="${n1(sh.cx)}" cy="${n1(sh.cy)}" r="${n1(Math.min(sh.rx, sh.ry) * 0.2)}" fill="url(#core)"/>`
  // sessions idle over three days are not drawn as stars: they are the dim points of the galaxy
  const r = rng(h0 + 1)
  for (let i = 0; i < Math.min(cell.room.homeCount, 14); i++) {
    const th = r() * 2 * Math.PI
    const t = 0.25 + Math.sqrt(r()) * 0.7
    const [x, y] = turn(sh, sh.rx * t * Math.cos(th), sh.ry * t * Math.sin(th))
    out += `<circle cx="${n1(x)}" cy="${n1(y)}" r="0.9" fill="#6B7488" opacity="0.5"/>`
  }
  return out
}

function backgroundStars(h: number): string {
  const r = rng(11)
  const n = Math.max(60, Math.min(160, Math.round((W * h) / 5500)))
  let out = ''
  for (let i = 0; i < n; i++) {
    const size = 0.35 + r() * r() * 1.5
    out += `<circle cx="${n1(r() * W)}" cy="${n1(r() * h)}" r="${n1(size)}" fill="${TEMP[Math.floor(r() * TEMP.length)]}" opacity="${n1(0.25 + r() * 0.75)}"/>`
  }
  return out
}

function build(rooms: Room[], now: number, cap: number, selectedId: string): Scene {
  clock = now / 1000
  const shownRooms = rooms.slice(0, MAX_ROOMS).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const n = Math.max(1, shownRooms.length)
  const cols = n === 1 ? 1 : 2
  const rows = Math.ceil(n / cols)
  const detail = shownRooms.length === 1
  const cw = (W - PAD * (cols + 1)) / cols
  const ch = detail ? DETAIL_H : OVER_H
  const H = Math.round(PAD + rows * (ch + PAD))
  const colorGlows = new Set<string>()
  const gradients = new Set<string>()
  const ctx: Ctx = {
    now,
    selectedId,
    detail,
    glow: c => {
      colorGlows.add(c)
      return `url(#g${c.slice(1)})`
    },
    by: new Map(),
  }

  const spots: Spot[] = []
  const labels: Label[] = []
  let bg = ''
  const stars: Star[] = []
  let shownWorkers = 0
  shownRooms.forEach((room, i) => {
    const cell: Cell = { room, x: PAD + (i % cols) * (cw + PAD), y: PAD + Math.floor(i / cols) * (ch + PAD), w: cw, h: ch }
    const sh = shapeOf(cell)
    const picked = [...room.workers].sort((a, b) => b.activityAt - a.activityAt).slice(0, detail ? cap * 2 : cap)
    const extra = room.workers.length - picked.length
    bg += backdropOf(cell, sh, gradients)
    stars.push(...place(cell, picked, detail))
    shownWorkers += picked.length
    const sub = [
      room.prNumbers.length ? `PR ${room.prNumbers.join(', ')}` : '',
      room.homeCount ? `згаслих: ${room.homeCount}` : '',
      picked.some(w => groupKeyOf(w) === 'decide') ? `чекають рішення: ${picked.filter(w => groupKeyOf(w) === 'decide').length}` : '',
      extra > 0 ? `ще: ${extra}` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    // the name, what is under it and the «+» are the pane's own text over the picture: what is pressed is what is seen
    labels.push({ key: room.key, name: room.name, sub, x: cell.x + 10, y: cell.y + 8, dark: true })
  })

  const byId = new Map(stars.map(s => [s.w.id, s]))
  // who waits for whom: a star that is waited for carries a ring, and its tooltip names those that wait
  for (const s of stars) {
    if (groupKeyOf(s.w) !== 'agent') continue
    const seen = new Set<string>()
    for (const x of s.w.waitsFor ?? []) {
      if (x.id === s.w.id || !byId.has(x.id) || seen.has(x.id)) continue
      seen.add(x.id)
      ctx.by.set(x.id, [...(ctx.by.get(x.id) ?? []), s.w.title])
    }
  }
  let rays = ''
  let fg = ''
  let top = ''
  let lights = ''
  let badges = ''
  for (const s of stars) {
    rays += tie(s, byId) + waits(s, byId, ctx)
    if (groupKeyOf(s.w) === 'decide') {
      lights += spotlight(s, (hash(s.w.id) % 24) / 10)
      badges += badge(s)
    }
    // the chosen one is drawn last, so its orbits lie over the stars beside it
    if (s.w.id === selectedId) top = star(s, ctx)
    else fg += star(s, ctx)
    spots.push({ id: s.w.id, x: n1(s.x), y: n1(s.y), tip: tipOf(s.w, ctx.by.get(s.w.id)) })
  }
  fg += top
  colorGlows.add(AMBER)

  let defs = '<defs>'
  defs +=
    '<radialGradient id="sky" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#16244A"/><stop offset="0.6" stop-color="#0A1129"/><stop offset="1" stop-color="#03050F"/></radialGradient>' +
    '<radialGradient id="vig" cx="50%" cy="50%" r="72%"><stop offset="0.55" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.65"/></radialGradient>' +
    '<linearGradient id="bandFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="0.5" stop-color="#FFFFFF"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>' +
    '<radialGradient id="core"><stop offset="0" stop-color="#FFF3D6" stop-opacity="0.95"/><stop offset="0.45" stop-color="#FFDDAA" stop-opacity="0.35"/><stop offset="1" stop-color="#FFDDAA" stop-opacity="0"/></radialGradient>' +
    '<filter id="haze" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter>' +
    '<filter id="milky" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.011 0.034" numOctaves="4" seed="7"/>' +
    '<feColorMatrix values="0 0 0 0 0.72  0 0 0 0 0.8  0 0 0 0 1  0 0 0 1.9 -0.62"/></filter>' +
    `<mask id="bandMask"><rect x="${-W}" y="${n1(H / 2 - 90)}" width="${3 * W}" height="180" fill="url(#bandFade)"/></mask>`
  for (const i of [...gradients].sort()) {
    const tint = TINTS[Number(i.slice(1))] as string
    defs += `<radialGradient id="${i}"><stop offset="0" stop-color="${tint}" stop-opacity="0.42"/><stop offset="0.6" stop-color="${tint}" stop-opacity="0.12"/><stop offset="1" stop-color="${tint}" stop-opacity="0"/></radialGradient>`
  }
  for (const c of [...colorGlows].sort()) {
    defs += `<radialGradient id="g${c.slice(1)}"><stop offset="0" stop-color="${c}" stop-opacity="0.9"/><stop offset="0.35" stop-color="${c}" stop-opacity="0.35"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`
  }
  defs += '</defs>'

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    defs +
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>` +
    `<g transform="rotate(-18 ${W / 2} ${n1(H / 2)})"><g mask="url(#bandMask)"><rect x="${-W}" y="${n1(H / 2 - 90)}" width="${3 * W}" height="180" fill="#FFFFFF" filter="url(#milky)" opacity="0.45"/></g></g>` +
    backgroundStars(H) +
    bg +
    `<rect width="${W}" height="${H}" fill="url(#vig)"/>` +
    lights +
    rays +
    fg +
    badges +
    '</svg>'
  return { svg, width: W, height: H, hiddenRooms: rooms.length - shownRooms.length, shownWorkers, spots, labels }
}

/**
 * Keeps the picture steady between draws. The pane is drawn again at every step of its scroll, and a picture whose text
 * differs at all is torn down and made anew by the host (it blinks, and its animations start over). The only thing that
 * differs between two draws of the same sky is where each animation cycle starts (it follows the clock), so when nothing
 * else has changed the picture drawn last time is given again, byte for byte.
 */
export function steady<T extends { svg: string }>(): (scene: T) => T {
  let last: { key: string; scene: T } | undefined
  return scene => {
    const { svg, ...rest } = scene
    const key = JSON.stringify(rest) + svg.replace(/ begin="-[\d.]+s"/g, '')
    if (last && last.key === key) return last.scene
    last = { key, scene }
    return scene
  }
}

/** The scene with the most sessions per galaxy that fits the size limit. */
export function galaxySvg(rooms: Room[], now: number, selectedId = ''): Scene {
  for (const cap of [14, 10, 6, 3]) {
    const out = build(rooms, now, cap, selectedId)
    if (out.svg.length <= SIZE_LIMIT) return out
  }
  return build(rooms, now, 1, selectedId)
}
