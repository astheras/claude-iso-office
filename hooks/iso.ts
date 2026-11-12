/** Isometric drawing primitives shared by the figures and the floor. */

export type Pt = [number, number]
export type Proj = (x: number, y: number, z?: number) => Pt

export const PALETTE = ['#7F77DD', '#D85A30', '#D4537E', '#378ADD', '#1D9E75', '#BA7517']
export const HAIR = ['#2C2C2A', '#633806', '#712B13', '#444441']

export const n1 = (n: number) => Math.round(n * 10) / 10
export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function hash(id: string): number {
  let h = 7
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}

/** Scales a #rrggbb colour's brightness: k < 1 darker, k > 1 lighter. */
export function shade(hex: string, k: number): string {
  const v = (i: number) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k)))
  return '#' + [1, 3, 5].map(i => v(i).toString(16).padStart(2, '0')).join('')
}

const pts = (a: Pt[]) => a.map(p => `${n1(p[0])},${n1(p[1])}`).join(' ')
export const poly = (a: Pt[], fill: string, stroke = 'none', sw = 0.6) =>
  `<polygon points="${pts(a)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`

/** A box: top plus the two faces that face the viewer (the +y face and the +x face). */
export function box(P: Proj, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, c: string): string {
  return (
    poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], shade(c, 0.9), shade(c, 0.6)) +
    poly([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], shade(c, 0.72), shade(c, 0.55)) +
    poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], shade(c, 1.1), shade(c, 0.6))
  )
}
