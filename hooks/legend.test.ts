import { expect, test } from 'claude-code/testing'

import { GROUP_COLOR, GROUP_TITLE } from './data'
import { legend } from './legend'

test('the legend has every list the pane can show, with the very title and colour of the list', () => {
  const { states } = legend('galaxy')
  for (const key of Object.keys(GROUP_COLOR) as (keyof typeof GROUP_COLOR)[]) {
    const s = states.find(x => x.key === key)
    expect(s).toBeDefined()
    expect(s?.title).toBe(GROUP_TITLE[key])
    expect(s?.color).toBe(GROUP_COLOR[key])
  }
})

test('it also tells the two states that are in no list: idle and gone home', () => {
  const keys = legend('office').states.map(s => s.key)
  expect(keys).toContain('rest')
  expect(keys).toContain('home')
  // the lists lead, in the order the pane draws them
  expect(keys.slice(0, 3)).toEqual(['err', 'decide', 'ask'])
})

test('every state says what it is and how it looks, in both themes, and no state is told twice', () => {
  for (const theme of ['galaxy', 'office'] as const) {
    const { states, marks } = legend(theme)
    expect(new Set(states.map(s => s.key)).size).toBe(states.length)
    for (const s of states) {
      expect(s.means.length).toBeGreaterThan(10)
      expect(s.looks.length).toBeGreaterThan(10)
      expect(s.mark).not.toBe('')
    }
    expect(marks.length).toBeGreaterThan(0)
  }
})

test('the looks follow the theme: stars in the galaxies, desks in the office', () => {
  const work = (t: 'galaxy' | 'office') => legend(t).states.find(s => s.key === 'work')!.looks
  expect(work('galaxy')).toMatch(/зірка/)
  expect(work('office')).toMatch(/стол/)
  // the office does not draw an error; it says so rather than invent a picture
  expect(legend('office').states.find(s => s.key === 'err')!.looks).toMatch(/у списку/)
})
