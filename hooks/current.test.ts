import { expect, test } from 'claude-code/testing'

import { currentSvg } from './current'

test('the band is a gradient from grey to nothing, so that it ends in whatever background the pane has', () => {
  const svg = currentSvg(300, 40)
  expect(svg).toContain('width="300"')
  expect(svg).toContain('height="40"')
  expect(svg).toContain('<linearGradient')
  const opacities = [...svg.matchAll(/stop-opacity="([\d.]+)"/g)].map(m => Number(m[1]))
  expect(opacities[0]).toBeGreaterThan(0)
  expect(opacities[opacities.length - 1]).toBe(0)
  // no colour of a theme in it: only the grey
  expect(new Set([...svg.matchAll(/stop-color="(#[0-9A-Fa-f]+)"/g)].map(m => m[1])).size).toBe(1)
})

test('a size that is not a positive whole number is made one', () => {
  const svg = currentSvg(0, -5.4)
  expect(svg).toContain('width="1"')
  expect(svg).toContain('height="1"')
})
