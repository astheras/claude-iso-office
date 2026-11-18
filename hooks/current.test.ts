import { expect, test } from 'claude-code/testing'

import { BAR_PX, currentSvg, FILL_OPACITY } from './current'

test('the band is a gradient from grey to nothing, so that it ends in whatever background the pane has', () => {
  const svg = currentSvg(300, 40)
  expect(svg).toContain('width="300"')
  expect(svg).toContain('height="40"')
  expect(svg).toContain('<linearGradient')
  const opacities = [...svg.matchAll(/stop-opacity="([\d.]+)"/g)].map(m => Number(m[1]))
  expect(opacities[0]).toBeGreaterThan(0)
  expect(opacities[opacities.length - 1]).toBe(0)
  // no colour of a theme in it: only the grey
  expect(new Set([...svg.matchAll(/(?:stop-color|fill)="(#[0-9A-Fa-f]+)"/g)].map(m => m[1])).size).toBe(1)
})

test('the fill stays faint, so that the text on it keeps its contrast; a solid bar at the left edge marks the row', () => {
  const svg = currentSvg(300, 40)
  // the strongest the fill gets: above this the dimmed text drops under 4.5:1 on a dark theme
  expect(FILL_OPACITY).toBeLessThanOrEqual(0.2)
  const fill = [...svg.matchAll(/stop-opacity="([\d.]+)"/g)].map(m => Number(m[1]))
  expect(Math.max(...fill)).toBeLessThanOrEqual(0.2)
  // the bar is solid and as high as the band
  expect(svg).toContain(`<rect width="${BAR_PX}" height="40" fill="#8A94A6" fill-opacity="0.9"/>`)
})

test('a size that is not a positive whole number is made one', () => {
  const svg = currentSvg(0, -5.4)
  expect(svg).toContain('width="1"')
  expect(svg).toContain('height="1"')
})
