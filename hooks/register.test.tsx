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

// What the engine does beneath the mod, answered one by one; the poll reads the session list through mcp.call.
const engine = ($: any, on: any) => {
  on('command.register', () => ({ value: { command: 'office' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: { id: 'timer' } }))
  on('ui.status', () => ({ value: undefined }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'CLAUDE_CODE_HOST_SESSION_ID' ? OWN.sessionId : undefined }))
  // like the app: list_sessions leaves out the session that asks; get_session answers for it
  on('mcp.call', (_: unknown, e: any) => ({
    value: {
      content: [{ type: 'text', text: JSON.stringify(e.tool === 'get_session' ? OWN : SESSIONS) }],
      isError: false,
    },
  }))
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
