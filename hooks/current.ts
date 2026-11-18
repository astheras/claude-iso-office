// The highlight of the session the pane is open in: a band behind its row in the list, grey at the left edge and fading
// into the pane's own background at the right. The fade is made with opacity, not with a second colour, so that it ends
// in whatever background the theme has, light or dark.
//
// Design rules it follows (Material's state layers, VS Code's list selection, WCAG 1.4.3):
//  - the fill is a faint tint of the background, never a mid-tone: text keeps the colour the theme gives it, and its
//    contrast stays at 4.5:1 or more on a light and on a dark theme (a mid grey at 40% pulled the dimmed lines and the
//    state colours down to ~2:1 and they blended in)
//  - the «this one» signal is carried by a solid bar on the left edge, so that the fill can stay faint
//  - the text is moved off the bar, so that they do not touch

// the same grey-blue as the icons, which reads on a light and on a dark theme
const GREY = '#8A94A6'
/** Opacity of the fill at its left edge. Above ~0.2 the dimmed text falls under 4.5:1 on a dark theme. */
export const FILL_OPACITY = 0.16
/** Opacity of the bar, and its width in px: a solid mark, not text, so 3:1 is enough. */
export const BAR_OPACITY = 0.9
export const BAR_PX = 3

/** The band as a drawing of the given size in px: a bar at the left edge, then a fill of grey fading to nothing. */
export function currentSvg(width: number, height: number): string {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    '<defs><linearGradient id="cur" x1="0" y1="0" x2="1" y2="0">' +
    `<stop offset="0" stop-color="${GREY}" stop-opacity="${FILL_OPACITY}"/>` +
    `<stop offset="0.55" stop-color="${GREY}" stop-opacity="${(FILL_OPACITY * 0.4).toFixed(3)}"/>` +
    `<stop offset="1" stop-color="${GREY}" stop-opacity="0"/>` +
    '</linearGradient></defs>' +
    `<rect width="${w}" height="${h}" fill="url(#cur)"/>` +
    `<rect width="${BAR_PX}" height="${h}" fill="${GREY}" fill-opacity="${BAR_OPACITY}"/>` +
    '</svg>'
  )
}
