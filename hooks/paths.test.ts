import { expect, test } from 'claude-code/testing'

import { CLAUDE_DIR_PS, claudeDir, transcriptGlobPs } from './paths'

test('the Claude folder is CLAUDE_CONFIG_DIR when it is set, else the .claude of the home folder, always with forward slashes', () => {
  expect(claudeDir({ home: 'C:\\Users\\x' })).toBe('C:/Users/x/.claude')
  expect(claudeDir({ configDir: 'D:\\Claude\\.claude', home: 'C:\\Users\\x' })).toBe('D:/Claude/.claude')
  expect(claudeDir({ configDir: 'D:/Claude/.claude/', home: 'C:/Users/x' })).toBe('D:/Claude/.claude')
  // an empty setting is no setting
  expect(claudeDir({ configDir: '', home: 'C:/Users/x' })).toBe('C:/Users/x/.claude')
  // nothing to go by: nothing
  expect(claudeDir({})).toBeUndefined()
  expect(claudeDir({ configDir: '' })).toBeUndefined()
})

test('the PowerShell for the folder prefers CLAUDE_CONFIG_DIR, and has no double quote that argument quoting could change', () => {
  expect(CLAUDE_DIR_PS.indexOf('$env:CLAUDE_CONFIG_DIR')).toBeLessThan(CLAUDE_DIR_PS.indexOf('$env:USERPROFILE'))
  expect(CLAUDE_DIR_PS.includes('"')).toBe(false)
  expect(transcriptGlobPs('$cli')).toBe("($cd + '\\projects\\*\\' + $cli + '.jsonl')")
})
