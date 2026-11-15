import { expect, test } from 'claude-code/testing'

import { tipSvg, wrapText } from './tip'

test('a tooltip is a rounded card with a white outline, as wide as its text asks and no wider than the cap', () => {
  const short = tipSvg('Чат — працює')
  expect(short.svg).toContain('rx="12"')
  expect(short.svg).toContain('stroke="#FFFFFF"')
  expect(short.svg).toContain('animation:in')
  const long = tipSvg('Панель блимає при скролінгу — закінчив, чекає і ще багато слів у назві, щоб не вмістилось в один рядок')
  expect(long.width).toBeLessThanOrEqual(300)
  expect(long.width).toBeGreaterThan(short.width)
  expect(long.height).toBeGreaterThan(short.height)
})

test('the text is wrapped at spaces, and a word too long for a line is cut', () => {
  expect(wrapText('aa bb cc', 5)).toEqual(['aa bb', 'cc'])
  expect(wrapText('abcdefgh', 3)).toEqual(['abc', 'def', 'gh'])
  expect(wrapText('', 3)).toEqual([''])
})

test('the text is written safely', () => {
  expect(tipSvg('<script>x</script>').svg).not.toContain('<script>')
})
