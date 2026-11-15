import { esc, n1 } from './iso'

/**
 * A tooltip card drawn as a picture: a Box of the pane has square corners and a border of one cell, but a drawing can
 * have rounded ones, a thin white outline and a fade-in. The pane shows it while the pointer is on a star.
 */

const FONT = 13
const CHAR = 8 // px per letter, a little more than a Cyrillic letter of 13 px takes, so that nothing is cut
const LINE = 18
const PAD_X = 12
const PAD_Y = 8
const RADIUS = 12
const MAX_W = 300
const MIN_W = 60

/** The text broken into lines of at most `max` letters: at spaces, and inside a word only when the word alone is too long. */
export function wrapText(text: string, max: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word
    while (w.length > max) {
      if (cur) {
        lines.push(cur)
        cur = ''
      }
      lines.push(w.slice(0, max))
      w = w.slice(max)
    }
    if (!cur) cur = w
    else if (cur.length + 1 + w.length <= max) cur += ` ${w}`
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

export type Tip = { svg: string; width: number; height: number }

export function tipSvg(text: string): Tip {
  const max = Math.floor((MAX_W - 2 * PAD_X) / CHAR)
  const lines = wrapText(text, max)
  const widest = Math.max(...lines.map(l => l.length))
  const width = Math.max(MIN_W, Math.min(MAX_W, Math.ceil(widest * CHAR + 2 * PAD_X)))
  const height = lines.length * LINE + 2 * PAD_Y
  const body = lines
    .map((l, i) => `<text x="${PAD_X}" y="${n1(PAD_Y + LINE * i + LINE * 0.72)}">${esc(l)}</text>`)
    .join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    '<style>@keyframes in{from{opacity:0}to{opacity:1}}g.f{animation:in .2s ease-out}</style>' +
    `<g class="f"><rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${RADIUS}" ry="${RADIUS}" fill="#0A1129" fill-opacity="0.96" stroke="#FFFFFF" stroke-width="1.2"/>` +
    `<g fill="#DCE8FF" font-family="system-ui, 'Segoe UI', sans-serif" font-size="${FONT}">${body}</g></g>` +
    '</svg>'
  return { svg, width, height }
}
