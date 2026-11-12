import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'iso-office',
  component: 'Pane',
  requestId: 'iso-office',
  props: {
    title: 'Office',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const SESSIONS = [
  { sessionId: 'a', title: 'Chat A', cwd: 'D:\\work\\my project', isRunning: true, lastActivityAt: new Date().toISOString(), link: 'claude://x/a' },
  {
    sessionId: 'b',
    title: 'Chat B',
    cwd: 'D:\\work\\my project',
    isRunning: false,
    lastActivityAt: new Date().toISOString(),
    link: 'claude://x/b',
    prNumber: 34,
    prState: 'OPEN',
  },
]

const OWN = {
  sessionId: 'me',
  title: 'This chat',
  cwd: 'D:\\work\\my project',
  isRunning: true,
  lastActivityAt: new Date().toISOString(),
  link: 'claude://x/me',
}

// how many times the session list was read, and what was run on the host
let polls = 0
const runs: string[][] = []

const DISK = JSON.stringify({
  meta: {
    cliSessionId: 'x',
    model: 'claude-sonnet-5-5',
    effort: 'xhigh',
    permissionMode: 'auto',
    createdAt: String(Date.now() - 3 * 3600000),
    lastTurnEdgeAt: String(Date.now() - 12 * 60000),
    completedTurns: '13',
  },
  cost: JSON.stringify({
    type: 'cost-state',
    totalCostUSD: 1.17,
    totalAPIDuration: 216033,
    totalToolDuration: 20973,
    totalDuration: 2765630,
    totalLinesAdded: 96,
    totalLinesRemoved: 36,
    modelUsage: {
      'claude-sonnet-5-5': {
        inputTokens: 90,
        outputTokens: 23573,
        thinkingTokens: 10165,
        cacheReadInputTokens: 4807590,
        cacheCreationInputTokens: 113531,
      },
    },
  }),
})

// What the engine does beneath the mod, answered one by one; the poll reads the session list through mcp.call.
const engine = ($: any, on: any) => {
  on('command.register', () => ({ value: { command: 'office' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: { id: 'timer' } }))
  on('clock.after', () => ({ value: { id: 'after' } }))
  on('ui.status', () => ({ value: undefined }))
  on('env.get', (_: unknown, e: any) => ({
    value: e.name === 'CLAUDE_CODE_HOST_SESSION_ID' ? OWN.sessionId : e.name === 'USERPROFILE' ? 'C:/Users/x' : undefined,
  }))
  // the registry of running chats: session b is blocked on the person
  on('fs.list', () => ({ value: [{ name: '1.json', kind: 'file' }, { name: '1.key', kind: 'file' }] }))
  on('fs.read', () => ({ value: JSON.stringify({ status: 'waiting', hostSessionId: 'b', statusUpdatedAt: Date.now() - 7 * 60000 }) }))
  // like the app: list_sessions leaves out the session that asks; get_session answers for it
  on('mcp.call', (_: unknown, e: any) => {
    if (e.tool === 'list_sessions') polls++
    const answer =
      e.tool === 'get_session'
        ? { ...OWN, branch: 'feature/x', model: 'claude-sonnet-5-5', effort: 'high' }
        : e.tool === 'get_usage'
          ? { context: { status: 'ok', tokensUsed: 224000, contextWindow: 1000000, percentUsed: 22 } }
          : SESSIONS
    return { value: { content: [{ type: 'text', text: JSON.stringify(answer) }], isError: false } }
  })
  // the script that reads what the app keeps on disk, and the command that opens a chat
  on('process.run', (_: unknown, e: any) => {
    runs.push([...e.argv])
    const stdout = e.argv[0] === 'powershell' ? DISK : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

const started = async ($: any, on: any) => {
  engine($, on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await new Promise(r => (globalThis as any).setTimeout(r, 100))
}

test('the desktop pane draws the office as one scene with the room names as buttons', async ($, on) => {
  await started($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  const scene: any = await ui.find({ type: 'Svg' })
  expect(scene).toBeDefined()
  expect(scene.props.source).toContain('<use href="#se')
  expect(await ui.find({ type: 'Button', text: /my project/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /працюють 2/ })).toBeDefined()
  await ui.unmount()
})

test('pressing a worker opens its accordion, pressing it again closes it; pressing a room shows that room alone', async ($, on) => {
  await started($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /Вартість/ })).toBeUndefined()
  await ui.press({ key: 'hit-a-0' })
  await new Promise(r => (globalThis as any).setTimeout(r, 200))
  expect(await ui.find({ type: 'Text', text: /Вартість/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\$1\.17$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /вихід 23\.6k · вхід 90 · міркування 10\.2k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /224k з 1M · 22%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /feature\/x/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /працює · 12 хв/ })).toBeDefined()
  // the title is the name alone: the group already says the state
  expect((await ui.find({ type: 'Button', text: /Chat A/ }))?.text).not.toMatch(/працює|хв/)

  await ui.press({ key: 'pick-a' })
  expect(await ui.find({ type: 'Text', text: /Вартість/ })).toBeUndefined()

  await ui.press({ key: 'room-d:/work/my project' })
  expect(await ui.find({ type: 'Button', text: /Весь офіс/ })).toBeUndefined()
  await ui.unmount()
})

test('a session that waits for an answer shows for how long', async ($, on) => {
  await started($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'pick-b' })
  await new Promise(r => (globalThis as any).setTimeout(r, 200))
  expect(await ui.find({ type: 'Text', text: /чекає відповіді · 7 хв/ })).toBeDefined()
  await ui.unmount()
})

test('each row has an arrow that opens its chat, with a tooltip', async ($, on) => {
  await started($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  const icons = (await ui.findAll({ type: 'Svg' })).filter((x: any) => x.props.source.includes('<title>Перейти в чат</title>'))
  expect(icons.length).toBeGreaterThan(0)
  runs.length = 0
  await ui.press({ key: 'go-a' })
  await new Promise(r => (globalThis as any).setTimeout(r, 50))
  expect(runs.some(c => c.includes('claude://x/a'))).toBe(true)
  await ui.unmount()
})

test('there is no bare "ок" button: a finished session gets a tick icon instead', async ($, on) => {
  await started($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Button', text: /^ок$/ })).toBeUndefined()
  await ui.unmount()
})

test('the terminal has no Svg: it draws the roster alone', async ($, on) => {
  await started($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /Chat A/ })).toBeDefined()
  await ui.unmount()
})

test('the session the pane lives in is drawn working, though list_sessions leaves it out', async ($, on) => {
  await started($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Button', text: /This chat — працює/ })).toBeDefined()
  await ui.unmount()
})

test('the desktop list has the groups, each session with its project under the title', async ($, on) => {
  await started($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // b needs an answer (registry), a and this chat are working
  expect(await ui.find({ type: 'Text', text: /Потребують відповіді · 1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /У роботі · 2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Завершені, чекають/ })).toBeUndefined()
  // the title is the name alone (no state, no time); the project, and the PR if any, is under it
  expect((await ui.find({ type: 'Button', text: /Chat B/ }))?.text).not.toMatch(/чекає|працює|хв/)
  expect(await ui.find({ type: 'Text', text: /my project · PR 34/ })).toBeDefined()
  await ui.unmount()
})

test('drawing the pane reads the sessions again, so switching to a chat shows fresh data', async ($, on) => {
  await started($, on)
  const before = polls
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await new Promise(r => (globalThis as any).setTimeout(r, 100))

  expect(polls).toBeGreaterThan(before)
  await ui.unmount()
})
