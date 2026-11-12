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

// how many times the session list was read
let polls = 0

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
  on('fs.read', () => ({ value: JSON.stringify({ status: 'waiting', hostSessionId: 'b' }) }))
  // like the app: list_sessions leaves out the session that asks; get_session answers for it
  on('mcp.call', (_: unknown, e: any) => {
    if (e.tool === 'list_sessions') polls++
    return {
      value: {
        content: [{ type: 'text', text: JSON.stringify(e.tool === 'get_session' ? OWN : SESSIONS) }],
        isError: false,
      },
    }
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

test('pressing a worker shows its card; pressing a room shows that room alone', async ($, on) => {
  await started($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Button', text: /Перейти в чат/ })).toBeUndefined()
  await ui.press({ key: 'hit-a-0' })
  expect((await ui.find({ type: 'Text', text: /Chat A/ }))?.text).toContain('Chat A')
  expect(await ui.find({ type: 'Button', text: /Перейти в чат/ })).toBeDefined()
  await ui.press({ key: 'card-close' })
  expect(await ui.find({ type: 'Button', text: /Перейти в чат/ })).toBeUndefined()

  await ui.press({ key: 'room-d:/work/my project' })
  expect(await ui.find({ type: 'Button', text: /Весь офіс/ })).toBeUndefined()
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
  expect(await ui.find({ type: 'Button', text: /Chat B/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /чекає відповіді/ })).toBeDefined()
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
