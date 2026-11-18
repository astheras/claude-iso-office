// The highlight of the session the pane is open in: a band behind its row in the list, grey at the left edge and fading
// into the pane's own background at the right. The fade is made with opacity, not with a second colour, so that it ends
// in whatever background the theme has, light or dark.

// the same grey-blue as the icons, which reads on a light and on a dark theme
const GREY = '#8A94A6'
const START_OPACITY = 0.4

/** The band as a drawing of the given size in px: one stretched rectangle, opaque grey at the left, clear at the right. */
export function currentSvg(width: number, height: number): string {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 10" preserveAspectRatio="none" width="${w}" height="${h}">` +
    '<defs><linearGradient id="cur" x1="0" y1="0" x2="1" y2="0">' +
    `<stop offset="0" stop-color="${GREY}" stop-opacity="${START_OPACITY}"/>` +
    `<stop offset="0.55" stop-color="${GREY}" stop-opacity="${START_OPACITY / 3}"/>` +
    `<stop offset="1" stop-color="${GREY}" stop-opacity="0"/>` +
    '</linearGradient></defs>' +
    '<rect width="100" height="10" fill="url(#cur)"/>' +
    '</svg>'
  )
}
