import type { Kind, Room, Worker } from '../types'
import { WORD } from './data'
import { alert, bob, body, bubble, dots, fade, L, talkText } from './figures'
import { box, esc, hash, HAIR, n1, PALETTE, poly } from './iso'
import type { Pt } from './iso'

/** The whole office as one isometric scene: a room per project, desks on one side, a break area on the other. */

const TW = 40
const TH = 20
const WALL = 46
const PAD = 12
const ROOM_W = 9.5
const ZONE = 4.9 // desks are left of this x, the break area right of it
const COLS = 2
export const MAX_ROOMS = 8
export const TRANSITION_MS = 12_000
export const SIZE_LIMIT = 120_000

/** A clickable place on the scene: a worker's torso, in scene px. */
export type Spot = { id: string; x: number; y: number }
/** Where a room's name goes, in scene px (the pane draws it as real text over the scene). */
export type Label = { key: string; name: string; sub: string; x: number; y: number }

export type FloorScene = {
  svg: string
  width: number
  height: number
  hiddenRooms: number
  shownWorkers: number
  spots: Spot[]
  labels: Label[]
}

type Item = { d: number; svg: string }
type Slot = 'talk0' | 'talk1' | 'talk2' | 'talk3' | 'coffee0' | 'coffee1' | 'couch0' | 'couch1'

const SLOTS: Slot[] = ['talk0', 'talk1', 'coffee0', 'couch0', 'couch1', 'talk2', 'talk3', 'coffee1']
const TALK: Pt[] = [
  [5.6, 3.7],
  [7.7, 3.7],
  [5.6, 5.0],
  [7.7, 5.0],
]
const COUCH: Pt[] = [
  [6.0, 1.05],
  [6.9, 1.05],
]
const COFFEE_BASE: Pt[] = [
  [6.9, 2.8],
  [7.5, 3.1],
]
const COFFEE_AT: Pt[] = [
  [8.5, 1.95],
  [8.0, 1.95],
]
const TINTS = ['#E9E6DB', '#E4E8DA', '#E6E3EC', '#E8E2D8']

const isDesk = (k: Kind) => k === 'work' || k === 'wait'
const ci = (w: Worker) => hash(w.id) % PALETTE.length
const color = (i: number) => PALETTE[i] as string
const hairOf = (i: number) => HAIR[i % HAIR.length] as string

/** Who stands where in the break area: stable by id, pairs first, a lone talker goes for a coffee instead. */
export function assignRest(rest: Worker[]): Map<string, Slot> {
  const sorted = [...rest].sort((a, b) => hash(a.id) - hash(b.id) || (a.id < b.id ? -1 : 1))
  const used = SLOTS.slice(0, Math.min(sorted.length, SLOTS.length))
  if (used.includes('talk0') && !used.includes('talk1')) used[used.indexOf('talk0')] = 'coffee0'
  if (used.includes('talk2') && !used.includes('talk3')) used[used.indexOf('talk2')] = 'coffee1'
  const m = new Map<string, Slot>()
  sorted.forEach((w, i) => m.set(w.id, used[i % used.length] as Slot))
  return m
}

type Plan = { room: Room; shown: Worker[]; extra: number; D: number; c: number; r: number; X0: number; Y0: number; Drow: number }

function build(rooms: Room[], now: number, cap: number, selectedId: string): FloorScene {
  const used = new Set<string>()
  const spots: Spot[] = []
  const labels: Label[] = []
  const ring = (id: string) =>
    id === selectedId ? '<ellipse cx="0" cy="1" rx="15" ry="7.5" fill="#EF9F2733" stroke="#EF9F27" stroke-width="1.6"/>' : ''
  const ref = (kind: 'st' | 'stc' | 'se', i: number) => {
    used.add(`${kind}${i}`)
    return `<use href="#${kind}${i}"/>`
  }

  // the busiest rooms are the ones shown (the caller's order), but they stand in a fixed order: by where the last
  // activity was, they would swap places, and the whole drawing with them, whenever two projects took turns
  const shownRooms = rooms.slice(0, MAX_ROOMS).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const cols = Math.min(COLS, Math.max(1, shownRooms.length))
  const plans: Plan[] = shownRooms.map((room, idx) => {
    const picked = [...room.workers].sort((a, b) => b.activityAt - a.activityAt).slice(0, cap)
    const shown = picked.sort((a, b) => (a.id < b.id ? -1 : 1))
    const deskRows = Math.ceil(shown.length / 2)
    return {
      room,
      shown,
      extra: room.workers.length - shown.length,
      D: Math.max(6, Math.ceil(1.6 + deskRows * 2 + 0.2)),
      c: idx % cols,
      r: Math.floor(idx / cols),
      X0: 0,
      Y0: 0,
      Drow: 0,
    }
  })
  const rowsN = plans.length ? plans[plans.length - 1]!.r + 1 : 1
  const rowD: number[] = []
  for (let r = 0; r < rowsN; r++) rowD[r] = Math.max(6, ...plans.filter(p => p.r === r).map(p => p.D))
  let y = 0
  const rowY: number[] = []
  for (let r = 0; r < rowsN; r++) {
    rowY[r] = y
    y += rowD[r] as number
  }
  for (const p of plans) {
    p.X0 = p.c * ROOM_W
    p.Y0 = rowY[p.r] as number
    p.Drow = rowD[p.r] as number
  }
  const Wt = cols * ROOM_W
  const Dt = y

  const ox = (Dt * TW) / 2 + PAD
  const oy = WALL + PAD + 4
  const P = (x: number, yy: number, z = 0): Pt => [ox + ((x - yy) * TW) / 2, oy + ((x + yy) * TH) / 2 - z]

  let ground = ''
  let walls = ''
  const items: Item[] = []
  const push = (d: number, svg: string) => items.push({ d, svg })

  // tall walls at the back and on the left; inner partitions stay low so nothing is hidden behind them
  walls += poly([P(0, 0), P(0, Dt), P(0, Dt, WALL), P(0, 0, WALL)], '#C8D3E0', '#8FA3B8')
  walls += poly([P(0, 0), P(Wt, 0), P(Wt, 0, WALL), P(0, 0, WALL)], '#B4C2D3', '#8FA3B8')

  let shownWorkers = 0
  plans.forEach((p, ri) => {
    const { X0, Y0, Drow } = p
    const g = (x: number, yy: number, z = 0): Pt => P(X0 + x, Y0 + yy, z)
    const dep = (x: number, yy: number) => X0 + x + Y0 + yy

    ground += poly([g(0, 0), g(ROOM_W, 0), g(ROOM_W, Drow), g(0, Drow)], TINTS[ri % TINTS.length] as string, '#CFCBBC', 0.6)
    let lines = ''
    for (let i = 1; i < ROOM_W; i++) lines += `M${n1(g(i, 0)[0])},${n1(g(i, 0)[1])}L${n1(g(i, Drow)[0])},${n1(g(i, Drow)[1])}`
    for (let j = 1; j < Drow; j++) lines += `M${n1(g(0, j)[0])},${n1(g(0, j)[1])}L${n1(g(ROOM_W, j)[0])},${n1(g(ROOM_W, j)[1])}`
    ground += `<path d="${lines}" stroke="#00000012" stroke-width="0.5" fill="none"/>`
    ground += `<path d="M${n1(g(ZONE, 0)[0])},${n1(g(ZONE, 0)[1])}L${n1(g(ZONE, Drow)[0])},${n1(g(ZONE, Drow)[1])}" stroke="#B8B2A0" stroke-width="1" stroke-dasharray="3 3" fill="none"/>`

    if (p.c > 0) push(X0 + Y0 + Drow / 2, box(P, X0 - 0.07, Y0, X0 + 0.07, Y0 + Drow, 0, 9, '#B8B2A0'))
    if (p.r > 0) push(X0 + Y0 + ROOM_W / 2, box(P, X0, Y0 - 0.07, X0 + ROOM_W, Y0 + 0.07, 0, 9, '#B8B2A0'))
    if (p.r === 0) {
      const w0: Pt[] = [g(5.5, 0, 16), g(7.3, 0, 16), g(7.3, 0, 36), g(5.5, 0, 36)]
      walls += poly(w0, '#EAF3FA', '#8FA3B8', 0.9)
    }

    // the room's name is drawn by the pane as real text at this spot; here only what goes under it
    const sub = [
      p.room.prNumbers.length ? `PR ${p.room.prNumbers.join(', ')}` : '',
      p.room.homeCount ? `вдома: ${p.room.homeCount}` : '',
      p.extra > 0 ? `ще: ${p.extra}` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    // at the front-left corner of the room: nobody stands there, so the name does not cover the workers
    const [lx, ly] = g(0.3, Drow - 0.6, 0)
    labels.push({ key: p.room.key, name: p.room.name, sub, x: lx, y: ly })

    // furniture of the break area
    push(dep(8.7, 1.0), box(P, X0 + 8.3, Y0 + 0.7, X0 + 9.1, Y0 + 1.4, 0, 24, '#8E3B2E') + `<circle cx="${n1(g(8.7, 1.4, 17)[0])}" cy="${n1(g(8.7, 1.4, 17)[1])}" r="1.6" fill="#EF9F27"/>`)
    push(dep(6.65, 4.05), box(P, X0 + 6.2, Y0 + 3.7, X0 + 7.1, Y0 + 4.4, 0, 11, '#CDB891'))
    push(dep(6.4, 1.05), box(P, X0 + 5.4, Y0 + 0.7, X0 + 7.4, Y0 + 1.4, 0, 9, '#7F77DD') + box(P, X0 + 5.4, Y0 + 0.7, X0 + 7.4, Y0 + 0.85, 9, 20, '#6A62C4'))

    const rest = p.shown.filter(w => w.kind === 'rest')
    const slots = assignRest(rest)
    // no time in the tooltip: it would change the drawing every minute, and a changed drawing is drawn afresh (it blinks)
    const tip = (w: Worker) => `${w.title} — ${WORD[w.kind]}${w.parentId ? ' (стажер)' : ''}`
    const scaleOf = (w: Worker, at: Pt, inner: string) =>
      `<g transform="translate(${n1(at[0])} ${n1(at[1])})${w.parentId ? ' scale(0.8)' : ''}">${inner}</g>`
    const aisle = (yy: number): Pt => g(ZONE - 0.2, yy)

    const deskPos = (i: number): { cx0: number; cy0: number; at: Pt } => {
      const col = i % 2
      const row = Math.floor(i / 2)
      const cx0 = 0.3 + col * 2.2
      const cy0 = 1.6 + row * 2
      return { cx0, cy0, at: g(cx0 + 1.0, cy0 + 0.5) }
    }

    /** What the worker looks like once settled at the desk. */
    const seatedFigure = (w: Worker, at: Pt) => {
      const c = ci(w)
      if (w.kind === 'wait') {
        const s = L(0.2, 0, 18)
        const a = L(0.4, -0.1, 33)
        const b = L(0.55, -0.1, 33)
        return scaleOf(
          w,
          at,
          `<title>${esc(tip(w))}</title>${ring(w.id)}<g>${bob('0.9s', 2)}${ref('se', c)}` +
            `<line x1="${n1(s[0])}" y1="${n1(s[1])}" x2="${n1(a[0])}" y2="${n1(a[1])}" stroke="${color(c)}" stroke-width="3" stroke-linecap="round"><animate attributeName="x2" values="${n1(a[0])};${n1(b[0])};${n1(a[0])}" dur="0.8s" repeatCount="indefinite"/></line>` +
            `<circle cx="${n1(a[0])}" cy="${n1(a[1])}" r="2.2" fill="#F6D3B8"><animate attributeName="cx" values="${n1(a[0])};${n1(b[0])};${n1(a[0])}" dur="0.8s" repeatCount="indefinite"/></circle>` +
            bubble(0, -46, alert(), '', '#EF9F27', '#FAEEDA') +
            `</g>`,
        )
      }
      return scaleOf(w, at, `<title>${esc(tip(w))}</title>${ring(w.id)}<g>${bob('0.55s', 1.2)}${ref('se', c)}${bubble(0, -46, dots())}</g>`)
    }

    /** What the worker looks like once settled in the break area, and where. */
    const restFigure = (w: Worker): { svg: string; at: Pt; d: number } => {
      const c = ci(w)
      const slot = slots.get(w.id) ?? 'couch0'
      const h = hash(w.id)
      if (slot.startsWith('talk')) {
        const k = Number(slot.slice(4))
        const [x, yy] = TALK[k] as Pt
        const at = g(x, yy)
        const pair = k < 2 ? 0 : 1
        const v = k % 2 === 0 ? '1;1;0;0;1' : '0;0;1;1;0'
        const dur = pair === 0 ? '5s' : '6.4s'
        return { svg: scaleOf(w, at, `<title>${esc(tip(w))}</title>${ring(w.id)}${ref('st', c)}${bubble(0, -44, talkText(), fade(v, dur))}`), at, d: dep(x, yy) }
      }
      if (slot.startsWith('couch')) {
        const [x, yy] = COUCH[Number(slot.slice(5))] as Pt
        const at = g(x, yy)
        return { svg: scaleOf(w, at, `<title>${esc(tip(w))}</title>${ring(w.id)}<g transform="translate(0 -3)">${ref('se', c)}</g>`), at, d: dep(x, yy) + 0.3 }
      }
      const k = Number(slot.slice(6))
      const a = g(...(COFFEE_BASE[k] as Pt))
      const m = g(...(COFFEE_AT[k] as Pt))
      const dur = 12 + (h % 7)
      const svg =
        `<g><title>${esc(tip(w))}</title>` +
        `<animateMotion dur="${dur}s" begin="-${h % 9}s" repeatCount="indefinite" calcMode="linear" path="M${n1(a[0])},${n1(a[1])}L${n1(m[0])},${n1(m[1])}L${n1(a[0])},${n1(a[1])}" keyPoints="0;0.5;0.5;1;1" keyTimes="0;0.3;0.6;0.9;1"/>` +
        `<g transform="${w.parentId ? 'scale(0.8)' : ''}">${ring(w.id)}<g>${bob()}${ref('stc', c)}</g></g></g>`
      return { svg, at: m, d: dep(...(COFFEE_AT[k] as Pt)) }
    }

    /** One-off walk between desk and break area, then the settled figure takes over. */
    const walk = (w: Worker, from: Pt, to: Pt, vias: Pt[], final: string, d: number) => {
      const pts = [from, ...vias, to]
      const segs = pts.slice(1).map((q, i) => Math.hypot(q[0] - (pts[i] as Pt)[0], q[1] - (pts[i] as Pt)[1]))
      const total = segs.reduce((s, v) => s + v, 0) || 1
      const dur = Math.max(2.5, total / 38)
      let acc = 0
      const times = ['0', ...segs.map(s => n1((acc += s) / total).toString())]
      const values = pts.map(q => `${n1(q[0] - from[0])} ${n1(q[1] - from[1])}`).join(';')
      const c = ci(w)
      const dd = n1(dur)
      const walker =
        `<g transform="translate(${n1(from[0])} ${n1(from[1])})">` +
        `<set attributeName="opacity" to="0" begin="${dd}s" fill="freeze"/>` +
        `<g><animateTransform attributeName="transform" type="translate" values="${values}" keyTimes="${times.join(';')}" calcMode="linear" dur="${dd}s" fill="freeze"/>` +
        `<g transform="${w.parentId ? 'scale(0.8)' : ''}"><g>${bob('0.45s', 1.5, '0s', String(Math.max(1, Math.floor(dur / 0.45))))}<title>${esc(tip(w))}</title>${ref('st', c)}</g></g></g></g>`
      push(
        d,
        walker + `<g opacity="0"><set attributeName="opacity" to="1" begin="${dd}s" fill="freeze"/>${final}</g>`,
      )
    }

    p.shown.forEach((w, i) => {
      shownWorkers++
      const { cx0, cy0, at } = deskPos(i)
      // the desk always stands; its monitor is dark and the chair empty while the worker is away
      const atDesk = isDesk(w.kind)
      push(dep(cx0 + 1.0, cy0 + 0.5) - 0.02, box(P, X0 + cx0 + 0.72, Y0 + cy0 + 0.24, X0 + cx0 + 1.28, Y0 + cy0 + 0.76, 0, 6, '#888780'))
      const led = g(cx0 + 1.0, cy0 + 1.38, 17)
      push(
        dep(cx0 + 1.0, cy0 + 1.7),
        box(P, X0 + cx0 + 0.1, Y0 + cy0 + 0.95, X0 + cx0 + 1.9, Y0 + cy0 + 1.7, 0, 14, '#D8B98A') +
          box(P, X0 + cx0 + 0.7, Y0 + cy0 + 1.28, X0 + cx0 + 1.3, Y0 + cy0 + 1.38, 14, 27, w.kind === 'work' ? '#2C2C2A' : '#5F5E5A') +
          `<circle cx="${n1(led[0])}" cy="${n1(led[1])}" r="1.6" fill="${w.kind === 'work' ? '#1D9E75' : w.kind === 'wait' ? '#EF9F27' : '#B4B2A9'}">` +
          (w.kind === 'work' ? `<animate attributeName="opacity" values="1;0.4;1" dur="1s" repeatCount="indefinite"/>` : '') +
          `</circle>`,
      )

      const moved =
        w.prevKind !== undefined && w.prevKind !== 'home' && isDesk(w.prevKind) !== atDesk && now - w.changedAt < TRANSITION_MS
      if (atDesk) {
        spots.push({ id: w.id, x: at[0], y: at[1] - 18 })
        const fig = seatedFigure(w, at)
        if (moved) {
          const from = g(6.65, 2.7)
          walk(w, from, at, [aisle(2.7), aisle(cy0 + 0.5)], fig, dep(cx0 + 1.0, cy0 + 0.5))
        } else push(dep(cx0 + 1.0, cy0 + 0.5), fig)
      } else {
        const r = restFigure(w)
        spots.push({ id: w.id, x: r.at[0], y: r.at[1] - 18 })
        if (moved) walk(w, at, r.at, [aisle(cy0 + 0.5), aisle(2.7)], r.svg, r.d)
        else push(r.d, r.svg)
      }
    })
  })

  items.sort((a, b) => a.d - b.d)
  let defs = '<defs>'
  for (const id of [...used].sort()) {
    const kind = id.startsWith('stc') ? 'stc' : id.startsWith('st') ? 'st' : 'se'
    const i = Number(id.slice(kind.length))
    defs += `<g id="${id}">${body(color(i), hairOf(i), { seated: kind === 'se', cup: kind === 'stc' })}</g>`
  }
  defs += '</defs>'

  const width = Math.round(((Wt + Dt) * TW) / 2 + PAD * 2)
  const height = Math.round(oy + ((Wt + Dt) * TH) / 2 + PAD)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    defs +
    ground +
    walls +
    items.map(i => i.svg).join('') +
    `</svg>`
  return { svg, width, height, hiddenRooms: rooms.length - shownRooms.length, shownWorkers, spots, labels }
}

/** The scene at the most people per room that fits the size limit. */
export function floorSvg(rooms: Room[], now: number, selectedId = ''): FloorScene {
  for (const cap of [8, 6, 4, 2]) {
    const out = build(rooms, now, cap, selectedId)
    if (out.svg.length <= SIZE_LIMIT) return out
  }
  return build(rooms, now, 1, selectedId)
}

