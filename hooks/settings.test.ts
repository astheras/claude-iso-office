import { expect, test } from 'claude-code/testing'

import { DEFAULT_SETTINGS, parseSettings, serializeSettings, settingsPath, THEMES } from './settings'

test('a saved theme is read back, in the three the pane offers', () => {
  expect(THEMES.map(t => t.key)).toEqual(['none', 'office', 'galaxy'])
  for (const theme of ['none', 'office', 'galaxy'] as const) {
    expect(parseSettings(serializeSettings({ theme }))).toEqual({ theme })
  }
})

test('what is missing, wrong or not JSON is the default, and other keys do no harm', () => {
  expect(DEFAULT_SETTINGS.theme).toBe('galaxy')
  expect(parseSettings('')).toEqual(DEFAULT_SETTINGS)
  expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS)
  expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS)
  expect(parseSettings('[]')).toEqual(DEFAULT_SETTINGS)
  expect(parseSettings('{}')).toEqual(DEFAULT_SETTINGS)
  expect(parseSettings('{"theme":"sky"}')).toEqual(DEFAULT_SETTINGS)
  expect(parseSettings('{"theme":3}')).toEqual(DEFAULT_SETTINGS)
  expect(parseSettings('{"theme":"office","other":1}')).toEqual({ theme: 'office' })
})

test('the file is indented and ends with a newline, so that it is easy to edit by hand', () => {
  expect(serializeSettings({ theme: 'office' })).toBe('{\n  "theme": "office"\n}\n')
})

test('the file lies in the folder of Claude', () => {
  expect(settingsPath('D:/Claude/.claude')).toBe('D:/Claude/.claude/iso-office.json')
})
