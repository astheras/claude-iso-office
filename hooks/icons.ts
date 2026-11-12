// Small line icons for the list. A Button cannot show a tooltip, but a drawing's <title> does (as on the workers), so
// each icon is a drawing with its tooltip and a clear Button laid over it for the press.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Cells the icon spans, and its size in px (a cell is about 7.5 px wide and 20 px tall). */
export const ICON_COLS = 4
export const ICON_W = 30
export const ICON_H = 20

const PATHS = {
  // an arrow leaving a corner: "go to the chat"
  open: 'M10.5 13.5 L19.5 6.5 M13.5 6.5 H19.5 V12.5',
  // a tick: "seen"
  seen: 'M10 10.5 L13.5 14 L20 6.5',
} as const

export type IconKind = keyof typeof PATHS

// a mid grey-blue that reads on a light and on a dark theme
const STROKE = '#8A94A6'

export function iconSvg(kind: IconKind, tip: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_W} ${ICON_H}" width="${ICON_W}" height="${ICON_H}">` +
    `<g><title>${esc(tip)}</title><rect width="${ICON_W}" height="${ICON_H}" fill="none" pointer-events="all"/>` +
    `<path d="${PATHS[kind]}" fill="none" stroke="${STROKE}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g>` +
    '</svg>'
  )
}
