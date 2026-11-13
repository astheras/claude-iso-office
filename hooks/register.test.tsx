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

// stopped, and its last message to a colleague (chat A) is a question about the Unity editor that nobody has answered
const D_SESSION = { sessionId: 'd', title: 'Chat D', cwd: 'D:\\work\\my project', isRunning: false, lastActivityAt: new Date().toISOString(), link: 'claude://x/d' }

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
  // stopped and idle: only a failed last reply (read from its transcript) puts it in a group
  { sessionId: 'c', title: 'Chat C', cwd: 'D:\\work\\my project', isRunning: false, lastActivityAt: new Date().toISOString(), link: 'claude://x/c' },
  D_SESSION,
  // stopped long enough ago to be idle, not so long as to be sent home: it is in no list
  { sessionId: 'e', title: 'Chat E', cwd: 'D:\\work\\my project', isRunning: false, lastActivityAt: new Date(Date.now() - 5 * 3600000).toISOString(), link: 'claude://x/e' },
]

// what the script that reads transcripts printed: chat c ended on a refused sign-in, chat d waits for chat A

const ERRORS = JSON.stringify({
  d: {
    peerTo: 'Chat A',
    peerId: '',
    peerAt: new Date(Date.now() - 3 * 60000).toISOString(),
    peerText: 'Питання по Editor: чи вільно? Якщо вільно, напиши «вільно».',
  },
  c: {
    code: 'authentication_failed',
    status: '403',
    text: 'Failed to authenticate. API Error: 403 Attention Required! | Cloudflare',
    at: new Date(Date.now() - 5 * 60000).toISOString(),
  },
})

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
// whether the system fails to open a claude:// link (the arrow, the «+»)
let refuseOpen = false

// a task list of three steps as the transcript holds it: one made, one move on
const planCall = (input: unknown, id: string) =>
  JSON.stringify({ isSidechain: false, type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'mcp__ccd_turn__update_plan', input }] } })
const PLAN_LINES = [
  planCall({ items: [{ content: 'Read', status: 'in_progress' }, { content: 'Write', status: 'pending' }, { content: 'Test', status: 'pending' }], scope: 'first_task' }, 't1'),
  planCall({ advance: true }, 't2'),
]
// what the script that reads the transcripts in pieces printed: chat a has the list, chat b has no transcript
const SKETCH = JSON.stringify({
  a: {
    from: 0,
    offset: 500,
    size: 500,
    plan: PLAN_LINES,
    cost: JSON.stringify({ type: 'cost-state', modelUsage: { m: { outputTokens: 60000, cacheReadInputTokens: 3000000 } } }),
  },
  b: { none: true },
})

const DISK = JSON.stringify({
  plan: PLAN_LINES,
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
    // the two scripts it is given: the transcript error read, and the chat details read
    const script = String(e.argv[4])
    const stdout = e.argv[0] !== 'powershell' ? '' : script.includes('isApiErrorMessage') ? ERRORS : script.includes('$items') ? SKETCH : DISK
    return { value: { exitCode: refuseOpen && e.argv[0] === 'cmd' ? 1 : 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

// the pane as it opens: in the galaxies
const startedFresh = async ($: any, on: any) => {
  engine($, on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await new Promise(r => (globalThis as any).setTimeout(r, 100))
}

// most tests look at the office: it is chosen first
const started = async ($: any, on: any) => {
  await startedFresh($, on)
  await $.command.run({ command: 'office', args: 'theme office' })
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

test('a chat that ended on an error is listed first, in red, with what went wrong', async ($, on) => {
  await started($, on)
  await new Promise(r => (globalThis as any).setTimeout(r, 300))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // the group titles in the order they are drawn: the failure leads
  const titles = (await ui.findAll({ type: 'Text' }))
    .map((x: any) => String(x.text))
    .filter((t: string) => /^(З помилкою|Потребують відповіді|У роботі|Завершені)/.test(t))
  expect(titles[0]).toBe('З помилкою · 1')
  expect(titles).toContain('Потребують відповіді · 1')

  const heading: any = await ui.find({ type: 'Text', text: /^З помилкою · 1$/ })
  expect(heading.props.color).toBe('#E5534B')
  const what: any = await ui.find({ type: 'Text', text: /помилка авторизації \(403\) · 5 хв тому/ })
  expect(what).toBeDefined()
  expect(what.props.color).toBe('#E5534B')
  expect(await ui.find({ type: 'Text', text: /з помилкою 1/ })).toBeDefined()
  await ui.unmount()
})

test('the accordion of a failed chat gives the error and its message', async ($, on) => {
  await started($, on)
  await new Promise(r => (globalThis as any).setTimeout(r, 300))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'pick-c' })
  await new Promise(r => (globalThis as any).setTimeout(r, 200))
  expect(await ui.find({ type: 'Text', text: /^помилка · 5 хв$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Failed to authenticate\. API Error: 403/ })).toBeDefined()
  await ui.unmount()
})

test('a transcript is read once per activity, not once per poll', async ($, on) => {
  await started($, on)
  await new Promise(r => (globalThis as any).setTimeout(r, 300))
  const reads = () => runs.filter(c => c[0] === 'powershell' && String(c[4]).includes('isApiErrorMessage')).length
  const before = reads()
  // it was read: the first poll found chats it had not read
  expect(before).toBeGreaterThan(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await new Promise(r => (globalThis as any).setTimeout(r, 300))
  // the pane drew and polled again, yet the chats were already read at this activity
  expect(reads()).toBe(before)
  await ui.unmount()
})

test('a chat that waits for a colleague for the Unity editor is listed with what it waits for', async ($, on) => {
  await started($, on)
  await new Promise(r => (globalThis as any).setTimeout(r, 300))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /^Чекають іншого агента · 1$/ })).toBeDefined()
  const line: any = await ui.find({ type: 'Text', text: /^чекає: Unity \(Chat A\)$/ })
  expect(line).toBeDefined()
  expect(line.props.color).toBe('#A98BE0')

  await ui.press({ key: 'pick-d' })
  await new Promise(r => (globalThis as any).setTimeout(r, 200))
  expect(await ui.find({ type: 'Text', text: /^чекає іншого агента · / })).toBeDefined()
  await ui.unmount()
})

test('/office theme switches between the office and the galaxies, and says which', async ($, on) => {
  await started($, on)
  await new Promise(r => (globalThis as any).setTimeout(r, 300))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const scene = async () => String(((await ui.find({ type: 'Svg' })) as any).props.source)

  // the office, as the helper chose it
  expect(await scene()).toContain('<use href="#se')

  expect((await $.command.run({ command: 'office', args: 'theme' })).text).toBe('Theme: galaxies.')
  await new Promise(r => (globalThis as any).setTimeout(r, 200))
  const galaxy = await scene()
  expect(galaxy).toContain('id="milky"')
  expect(galaxy).toContain('data-s="a"')
  expect(galaxy).not.toContain('<use href="#se')
  expect(await ui.find({ type: 'Svg' })).toBeDefined()

  // a name to the theme, and a wrong one is told off and changes nothing
  expect((await $.command.run({ command: 'office', args: 'theme sky' })).text).toMatch(/Themes: office, galaxy/)
  expect((await $.command.run({ command: 'office', args: 'theme galaxy' })).text).toBe('Theme: galaxies.')
  expect((await $.command.run({ command: 'office', args: 'theme office' })).text).toBe('Theme: office.')
  await new Promise(r => (globalThis as any).setTimeout(r, 200))
  expect(await scene()).toContain('<use href="#se')
  await ui.unmount()
})

test('in the galaxies a star is pressed like a worker, and a project name like a room', async ($, on) => {
  await started($, on)
  await new Promise(r => (globalThis as any).setTimeout(r, 300))
  await $.command.run({ command: 'office', args: 'theme galaxy' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await new Promise(r => (globalThis as any).setTimeout(r, 200))

  expect(await ui.find({ type: 'Text', text: /Вартість/ })).toBeUndefined()
  await ui.press({ key: 'hit-a-0' })
  await new Promise(r => (globalThis as any).setTimeout(r, 200))
  expect(await ui.find({ type: 'Text', text: /Вартість/ })).toBeDefined()
  // the accordion says how far the plan has got, and each step
  expect(await ui.find({ type: 'Text', text: /^1 з 3$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Write$/ })).toBeDefined()

  // the project's name is the pane's own light text, a button of its own: what is pressed is what is seen
  const name: any = await ui.find({ type: 'Text', text: /^my project$/ })
  expect(name).toBeDefined()
  expect(name.props.color).toBe('#DCE8FF')
  expect(await ui.find({ type: 'Button', text: /my project/ })).toBeDefined()
  await ui.unmount()
})

test('the transcripts are read for the plan of every chat on screen, and the list says how far each has got', async ($, on) => {
  await started($, on)
  await new Promise(r => (globalThis as any).setTimeout(r, 400))
  const reads = () => runs.filter(c => c[0] === 'powershell' && String(c[4]).includes('$items'))
  expect(reads().length).toBeGreaterThan(0)
  // the chats that were asked for, each from the start
  expect(String(reads()[0]![4])).toMatch(/\$items = '(?:[^']*;)?a:0(?:;|')/)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await new Promise(r => (globalThis as any).setTimeout(r, 200))
  // chat a is on step two of three: one step done
  expect(await ui.find({ type: 'Text', text: /^план 1\/3$/ })).toBeDefined()
  await ui.unmount()
})

test('a chat read to the end is not read again at the next poll', async ($, on) => {
  await started($, on)
  await new Promise(r => (globalThis as any).setTimeout(r, 400))
  const reads = () => runs.filter(c => c[0] === 'powershell' && String(c[4]).includes('$items')).length
  const before = reads()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await new Promise(r => (globalThis as any).setTimeout(r, 300))
  // a running chat may be read again after twenty seconds, not at once; the stopped ones are read to the end
  expect(reads()).toBe(before)
  await ui.unmount()
})

test('an idle session is in no list, but pressing it in the picture opens its data under the lists', async ($, on) => {
  await started($, on)
  await new Promise(r => (globalThis as any).setTimeout(r, 300))
  await $.command.run({ command: 'office', args: 'theme galaxy' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await new Promise(r => (globalThis as any).setTimeout(r, 200))

  expect(await ui.find({ type: 'Button', text: /Chat E/ })).toBeUndefined()
  await ui.press({ key: 'hit-e-0' })
  await new Promise(r => (globalThis as any).setTimeout(r, 300))
  expect(await ui.find({ type: 'Text', text: /^Простоює · обрана$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Chat E/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Вартість/ })).toBeDefined()

  // pressed again it closes, and the block goes
  await ui.press({ key: 'pick-e' })
  await new Promise(r => (globalThis as any).setTimeout(r, 200))
  expect(await ui.find({ type: 'Text', text: /^Простоює · обрана$/ })).toBeUndefined()
  await ui.unmount()
})

test('the «+» by a project opens a new session in its folder through the app\'s link, in both themes', async ($, on) => {
  await started($, on)
  await new Promise(r => (globalThis as any).setTimeout(r, 300))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const key = 'new-d:/work/my project'
  const opened = () => runs.filter(c => c[0] === 'cmd' && c.some(a => a.startsWith('claude://code/new')))

  // it has a tooltip, as the arrow has: an icon with a title
  const icons = (await ui.findAll({ type: 'Svg' })).filter((x: any) => x.props.source.includes('<title>Нова сесія в проєкті</title>'))
  expect(icons).toHaveLength(1)

  // the office
  runs.length = 0
  await ui.press({ key })
  await new Promise(r => (globalThis as any).setTimeout(r, 200))
  expect(opened()).toHaveLength(1)
  // the folder rides in the link, written so that nothing in it means anything to the shell
  expect(opened()[0]!.at(-1)).toBe('claude://code/new?folder=D%3A%5Cwork%5Cmy%20project')

  // the galaxies
  await $.command.run({ command: 'office', args: 'theme galaxy' })
  await new Promise(r => (globalThis as any).setTimeout(r, 200))
  expect((await ui.findAll({ type: 'Svg' })).filter((x: any) => x.props.source.includes('<title>Нова сесія в проєкті</title>'))).toHaveLength(1)
  runs.length = 0
  await ui.press({ key })
  await new Promise(r => (globalThis as any).setTimeout(r, 200))
  expect(opened()).toHaveLength(1)
  await ui.unmount()
})

test('a link that did not open is told under the picture, and the next press tries again', async ($, on) => {
  await started($, on)
  await new Promise(r => (globalThis as any).setTimeout(r, 300))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const key = 'new-d:/work/my project'
  refuseOpen = true
  await ui.press({ key })
  await new Promise(r => (globalThis as any).setTimeout(r, 200))
  expect(await ui.find({ type: 'Text', text: /Не вдалося відкрити нову сесію \(код 1\)/ })).toBeDefined()

  refuseOpen = false
  await ui.press({ key })
  await new Promise(r => (globalThis as any).setTimeout(r, 200))
  expect(await ui.find({ type: 'Text', text: /Не вдалося відкрити нову сесію/ })).toBeUndefined()
  await ui.unmount()
})

test('the terminal, which has no drawing, gives the «+» as a plain glyph button', async ($, on) => {
  await started($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // the terminal draws a roster, not rooms: no label, so no «+» (nothing to put it beside)
  expect(await ui.find({ type: 'Button', text: /^\+$/ })).toBeUndefined()
  await ui.unmount()
})

test('the coworking room has a «+» too, which opens a session with no folder; a remote office has none', async ($, on) => {
  const now = new Date().toISOString()
  const cowork = { sessionId: 'w', title: 'Chat W', cwd: 'C:\\Users\\x\\scratch-workspaces\\y', isRunning: true, lastActivityAt: now, link: 'claude://x/w' }
  const remote = { sessionId: 'r', title: 'Chat R', cwd: '/home/x/app', isRunning: true, lastActivityAt: now, link: 'claude://x/r' }
  SESSIONS.push(cowork, remote)
  try {
    await started($, on)
    await new Promise(r => (globalThis as any).setTimeout(r, 300))
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const adds = async () => (await ui.findAll({ type: 'Svg' })).filter((x: any) => x.props.source.includes('<title>Нова сесія в проєкті</title>')).length
    // the project and the coworking room, not the remote office
    expect(await adds()).toBe(2)
    expect(await ui.find({ type: 'Button', key: 'new-#cowork' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'new-#remote' })).toBeUndefined()

    runs.length = 0
    await ui.press({ key: 'new-#cowork' })
    await new Promise(r => (globalThis as any).setTimeout(r, 200))
    const opened = runs.filter(c => c[0] === 'cmd' && c.some(a => a.startsWith('claude://code/new')))
    expect(opened).toHaveLength(1)
    expect(opened[0]!.at(-1)).toBe('claude://code/new')
    await ui.unmount()
  } finally {
    SESSIONS.splice(SESSIONS.indexOf(cowork), 1)
    SESSIONS.splice(SESSIONS.indexOf(remote), 1)
  }
})

test('with one project chosen, in the galaxies, its «+» is there as well', async ($, on) => {
  await started($, on)
  await new Promise(r => (globalThis as any).setTimeout(r, 300))
  await $.command.run({ command: 'office', args: 'theme galaxy' })
  await $.ui.mount({ ...PANE, surface: 'desktop' }).then(async (ui: any) => {
    await new Promise(r => (globalThis as any).setTimeout(r, 200))
    // one galaxy on the screen: the detail view, with the planets
    expect(await ui.find({ type: 'Button', key: 'new-d:/work/my project' })).toBeDefined()
    await ui.press({ key: 'room-d:/work/my project' })
    await new Promise(r => (globalThis as any).setTimeout(r, 200))
    expect(await ui.find({ type: 'Button', key: 'new-d:/work/my project' })).toBeDefined()
    await ui.unmount()
  })
})

test('the pane opens in the galaxies, and the office is a choice', async ($, on) => {
  await startedFresh($, on)
  await new Promise(r => (globalThis as any).setTimeout(r, 300))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const scene = async () => String(((await ui.find({ type: 'Svg' })) as any).props.source)
  expect(await scene()).toContain('id="milky"')
  // a bare /office theme goes to the other one, the office
  expect((await $.command.run({ command: 'office', args: 'theme' })).text).toBe('Theme: office.')
  await new Promise(r => (globalThis as any).setTimeout(r, 200))
  expect(await scene()).toContain('<use href="#se')
  await ui.unmount()
})
