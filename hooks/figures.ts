import { box, n1, shade } from './iso'
import type { Pt } from './iso'

/** People and speech bubbles, drawn with their feet at (0,0) so they can be placed, reused and moved. */

const TW = 40
const TH = 20

/** Local projection: tile coordinates to screen px, origin at the figure's feet. */
export const L = (x: number, y: number, z = 0): Pt => [((x - y) * TW) / 2, ((x + y) * TH) / 2 - z]

const SKIN = '#F6D3B8'

export function body(color: string, hair: string, opts: { seated?: boolean; cup?: boolean }): string {
  const lift = opts.seated ? 6 : 9
  const torsoTop = opts.seated ? 20 : 22
  const [hx, hy] = L(0, 0, torsoTop + 6)
  let s = ''
  if (!opts.seated) {
    s += box(L, -0.16, -0.1, -0.02, 0.1, 0, lift, shade(color, 0.55))
    s += box(L, 0.02, -0.1, 0.16, 0.1, 0, lift, shade(color, 0.55))
  }
  s += box(L, -0.2, -0.14, 0.2, 0.14, lift, torsoTop, color)
  s += `<circle cx="${n1(hx)}" cy="${n1(hy)}" r="5.4" fill="${SKIN}" stroke="${shade(SKIN, 0.7)}" stroke-width="0.6"/>`
  s += `<path d="M${n1(hx - 5.4)},${n1(hy - 0.5)} A5.4 5.4 0 0 1 ${n1(hx + 5.4)},${n1(hy - 0.5)} Z" fill="${hair}"/>`
  s += `<circle cx="${n1(hx - 2)}" cy="${n1(hy + 1.2)}" r="0.9" fill="#2C2C2A"/><circle cx="${n1(hx + 2)}" cy="${n1(hy + 1.2)}" r="0.9" fill="#2C2C2A"/>`
  if (opts.cup) {
    const [cx, cy] = L(0.3, 0.05, 16)
    s += `<rect x="${n1(cx - 2)}" y="${n1(cy - 2)}" width="4" height="4" rx="0.8" fill="#FFFFFF" stroke="#888780" stroke-width="0.5"/>`
  }
  return s
}

/** A speech bubble centred at (x,y), its tail pointing down; `anim` goes inside the group (e.g. an opacity animate). */
export function bubble(x: number, y: number, inner: string, anim = '', stroke = '#5DCAA5', fill = '#FFFFFF'): string {
  return (
    `<g transform="translate(${n1(x)} ${n1(y)})">${anim}` +
    `<path d="M-9,-6 h18 a2,2 0 0 1 2,2 v8 a2,2 0 0 1 -2,2 h-6 l-3,4 l-3,-4 h-6 a2,2 0 0 1 -2,-2 v-8 a2,2 0 0 1 2,-2 z" fill="${fill}" stroke="${stroke}" stroke-width="0.8"/>` +
    inner +
    `</g>`
  )
}

/** Three dots that light up one after another: "typing". */
export const dots = (): string =>
  [-5, 0, 5]
    .map(
      (x, i) =>
        `<circle cx="${x}" cy="-0.5" r="1.5" fill="#085041"><animate attributeName="opacity" values="0.2;1;0.2" dur="1s" begin="${i * 0.3}s" repeatCount="indefinite"/></circle>`,
    )
    .join('')

export const talkText = (): string =>
  '<text y="3" text-anchor="middle" font-size="9" fill="#444441" font-family="sans-serif">…</text>'

export const alert = (): string =>
  '<text y="3.4" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="10" fill="#854F0B">!</text>'

/** Opacity pulsing between the listed values, forever. */
export const fade = (values: string, dur: string, begin = '0s'): string =>
  `<animate attributeName="opacity" values="${values}" dur="${dur}" begin="${begin}" repeatCount="indefinite"/>`

/** The little up-and-down of a step or a keystroke. */
export const bob = (dur = '0.45s', amp = 1.5, begin = '0s', repeat = 'indefinite'): string =>
  `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${-amp};0 0" dur="${dur}" begin="${begin}" repeatCount="${repeat}"/>`
