import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Memory, Office, RawSession, Room, View, Worker } from '../types'
import { ack, ago, classify, emptyMemory, groupSessions, parseSessions, summary, WORD } from './data'
import type { Group } from './data'
import { floorSvg } from './floor'
import type { Label, Spot } from './floor'

const PANE = 'iso-office'
const TITLE = 'Office'
const POLL_MS = 5000

// How the pane lays out its cells, measured on the desktop from the user's screenshots: a cell is ~7.5 px wide and
// ~20 px tall (2.65 times as tall), and the drawing fills the pane's width plus ~0.6 of a cell. Overlaid buttons are
// placed in these cells.
const ROW_RATIO = 2.65
const EXTRA_COLS = 0.6
const CELL_PX = 7.54 // css px per cell, measured
// a button label that draws nothing and is not whitespace (a plain space is trimmed away): braille blank
const BLANK = '⠀⠀⠀⠀'

const memory = atom({ plugin: 'iso-office', key: 'memory' } as const, emptyMemory(), { shape: 'memory-2' })
const office = atom({ plugin: 'iso-office', key: 'office' } as const, { at: 0, rooms: [] } as Office, {
  shape: 'office-2',
})
const view = atom({ plugin: 'iso-office', key: 'view' } as const, { room: '', selected: '', note: '', debug: false } as View, {
  shape: 'view-4',
})

// a poll that has not answered in this long is taken for lost, so one hung call cannot stop the office for good
const STUCK_MS = 20000
// after a turn starts or ends the app takes a moment to flip `isRunning`: ask once more shortly after
const SETTLE_MS = 1500

// drawing the pane asks for a fresh poll, at most this often: switching to a chat draws its pane, and the timer of a
// chat that was in the background may not have run while the person was elsewhere
const RENDER_POLL_MS = 1500

let isPolling = false
let lastRenderPollAt = 0
let pollStartedAt = 0
let lastPollAt = 0
let ticker: Timer | undefined

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content.map(b => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '')).join('')
    : String(content)

/** Activity times to the minute: a running session moves its time every poll, and the pane must not redraw for that. */
const quantize = (rooms: Room[]): Room[] =>
  rooms.map(r => ({ ...r, workers: r.workers.map(w => ({ ...w, activityAt: Math.floor(w.activityAt / 60000) * 60000 })) }))

/** The id the app gives this very session; list_sessions never lists the session that asks, so it is fetched alone. */
const ownId = async ($: EngineInterface) => (await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')) || undefined

async function ownSession($: EngineInterface, id: string | undefined): Promise<RawSession | undefined> {
  if (!id) return undefined
  try {
    const r = await $.mcp.call('ccd_session_mgmt', 'get_session', { session_id: id })
    if (r.isError) return undefined
    const s: unknown = JSON.parse(textOf(r.content))
    return s && typeof s === 'object' && (s as RawSession).sessionId === id ? (s as RawSession) : undefined
  } catch {
    return undefined
  }
}

/**
 * Ids of the chats that are blocked on the person. list_sessions does not say so, but each running chat keeps a
 * registry file (~/.claude/sessions/<pid>.json) with its `status` and its app id; `waiting` is a permission or a question.
 * Anything unreadable counts as nobody: the list then has no "need an answer" group, nothing else changes.
 */
async function waitingSessions($: EngineInterface): Promise<Set<string>> {
  const ids = new Set<string>()
  try {
    const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
    if (!home) return ids
    const dir = `${home.replace(/\\/g, '/')}/.claude/sessions`
    const files = (await $.fs.list(dir)).filter(f => /^\d+\.json$/.test(f.name))
    await Promise.all(
      files.map(async f => {
        try {
          const j: unknown = JSON.parse(await $.fs.read(`${dir}/${f.name}`))
          const o = j as { status?: unknown; hostSessionId?: unknown }
          if (o && o.status === 'waiting' && typeof o.hostSessionId === 'string') ids.add(o.hostSessionId)
        } catch {
          // a file that is half written or just removed: skip it
        }
      }),
    )
  } catch {
    // no registry to read
  }
  return ids
}

async function poll($: EngineInterface) {
  const t = Date.now()
  if (isPolling && t - pollStartedAt < STUCK_MS) return
  isPolling = true
  pollStartedAt = t
  try {
    const me = await ownId($)
    const [r, own, asking] = await Promise.all([
      $.mcp.call('ccd_session_mgmt', 'list_sessions', { limit: 100 }),
      ownSession($, me),
      waitingSessions($),
    ])
    if (r.isError) throw new Error(textOf(r.content).slice(0, 200))
    const listed = parseSessions(textOf(r.content))
    if (own && !listed.some(s => s.sessionId === own.sessionId)) listed.push(own)
    const raw = listed.map(s => (asking.has(s.sessionId) ? { ...s, needsAnswer: true } : s))
    lastPollAt = Date.now()
    const prev = await read($, memory)
    const prevOffice = await read($, office)
    const now = Date.now()
    const next = classify(raw, prev, now)
    const rooms = quantize(next.rooms)

    // write only what changed, so the pane (and its animations) redraw only then
    if (JSON.stringify(next.memory) !== JSON.stringify(prev)) await update($, memory, () => next.memory)
    if (JSON.stringify(rooms) !== JSON.stringify(prevOffice.rooms) || prevOffice.error) {
      await update($, office, () => ({ at: now, rooms }))
    }
    void $.ui.status(`Office: ${summary(rooms)}`)
    // no toast for the chat the person is in: its answer is in front of them
    const finished = next.events.filter(e => e.id !== me)
    if (!prev.muted && finished.length > 0) {
      const names = finished.map(e => e.title)
      void $.ui.toast(
        names.length === 1 ? `Закінчила: ${names[0]}` : `Закінчили (${names.length}): ${names.slice(0, 2).join(', ')}…`,
        { timeoutMs: 6000 },
      )
    }
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).slice(0, 200)
    const cur = await read($, office)
    if (cur.error !== msg) await update($, office, o => ({ ...o, error: msg }))
  } finally {
    // a poll declared lost must not clear the flag of the one that replaced it
    if (pollStartedAt === t) isPolling = false
  }
}

/** Starts the five-second poll, or starts it again when it has gone quiet (a lost timer would freeze the office). */
function ensureTicker($: EngineInterface, force = false) {
  if (!force && ticker && Date.now() - lastPollAt < POLL_MS * 4) return
  ticker?.cancel()
  ticker = $.clock.every(POLL_MS, () => void poll($))
}

/** A turn starting or ending changes this session's state at once: look now, and again once the app has settled. */
function pollSoon($: EngineInterface) {
  ensureTicker($)
  void poll($)
  $.clock.after(SETTLE_MS, () => void poll($))
}

const open = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE })

const MARK = { work: '▶', wait: '!', rest: '·', home: '' } as const
const GROUP_MARK = { ask: '?', work: '▶', done: '!' } as const

async function seen($: EngineInterface, ids: string[]) {
  await update($, memory, m => ids.reduce((acc, id) => ack(acc, id), m) as Memory)
  void poll($)
}

const pick = ($: EngineInterface, id: string) =>
  update($, view, v => ({ ...v, selected: v.selected === id ? '' : id, note: '' }))

const goRoom = ($: EngineInterface, key: string) => update($, view, v => ({ ...v, room: key, note: '' }))

/** Opens a chat through the system's handler for its claude:// link, the way a click on the link would. */
async function openChat($: EngineInterface, link: string) {
  if (!/^claude:\/\/[A-Za-z0-9._\/-]+$/.test(link)) {
    await update($, view, v => ({ ...v, note: 'Не вдалося відкрити: посилання не розпізнано.' }))
    return
  }
  try {
    const r = await $.process.run(['cmd', '/c', 'start', '', link])
    await update($, view, v => ({ ...v, note: r.exitCode === 0 ? '' : `Не вдалося відкрити (код ${r.exitCode}).` }))
  } catch (err) {
    await update($, view, v => ({ ...v, note: `Не вдалося відкрити: ${String(err).slice(0, 100)}` }))
  }
}

const waiting = (rooms: Room[]) => rooms.flatMap(r => r.workers.filter(w => w.kind === 'wait'))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'office', description: 'Office pane: /office [mute|unmute|seen]' })
    void open($)
    lastRenderPollAt = 0
    void poll($)
    ensureTicker($, true)
    return next(e)
  })

  // reactive reads: the person's prompt and the end of a turn move this session between desk and break area
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) pollSoon($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) pollSoon($)
    return next(e)
  })

  on('command.run', { command: 'office' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'mute' || arg === 'unmute') {
      await update($, memory, m => ({ ...m, muted: arg === 'mute' }) as Memory)
      return { text: arg === 'mute' ? 'Office notifications muted.' : 'Office notifications on.' }
    }
    if (arg === 'debug') {
      const next = !(await read($, view)).debug
      await update($, view, v => ({ ...v, debug: next }))
      return { text: next ? 'Click areas are shown.' : 'Click areas are hidden.' }
    }
    if (arg === 'seen') {
      const ids = waiting((await read($, office)).rooms).map(w => w.id)
      await seen($, ids)
      return { text: `Marked ${ids.length} as seen.` }
    }
    await open($)
    void poll($)
    return { text: 'Office pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // refresh when the pane is drawn (switching chats draws it); a timer, since a hook that draws may not write state
    const t = Date.now()
    if (t - lastRenderPollAt > RENDER_POLL_MS) {
      lastRenderPollAt = t
      ensureTicker($)
      $.clock.after(1, () => void poll($))
    }

    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // the terminal draws no SVG: it gets the roster in words, whatever its table says
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined
    const o = await read($, office)
    const m = await read($, memory)
    const v = await read($, view)
    const now = Date.now()
    const wait = waiting(o.rooms)
    const active = o.rooms.filter(r => r.workers.length > 0)
    const room = active.find(r => r.key === v.room)
    const shown = room ? [room] : active
    const quiet = o.rooms.length - active.length
    const scene = Svg && shown.length > 0 ? floorSvg(shown, now, v.selected) : undefined
    const count = (k: Worker['kind']) => shown.reduce((n, r) => n + r.workers.filter(w => w.kind === k).length, 0)

    const chosen = o.rooms.flatMap(r => r.workers.map(w => ({ w, r }))).find(x => x.w.id === v.selected)

    const row = (w: Worker) => (
      <Box flexDirection="row" gap={1}>
        <Button key={`pick-${w.id}`} plain dimColor={w.kind === 'rest'} onPress={() => void pick($, w.id)}>
          {MARK[w.kind]} {w.parentId ? '↳ ' : ''}
          {w.title} — {WORD[w.kind]}, {ago(w.activityAt, now)}
        </Button>
        {w.kind === 'wait' && (
          <Button key={`ack-${w.id}`} plain onPress={() => void seen($, [w.id])}>
            ок
          </Button>
        )}
      </Box>
    )

    // below the drawing: sessions in three lists, a title and, under it, the project; only the chosen project when one is
    const groups = groupSessions(shown)
    const item = (g: Group, { w, room: r }: Group['items'][number]) => (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button key={`pick-${w.id}`} plain onPress={() => void pick($, w.id)}>
            <Text color={g.color}>{GROUP_MARK[g.key]}</Text> {w.parentId ? '↳ ' : ''}
            {w.title}
            <Text dimColor>
              {' '}
              — {g.key === 'ask' ? 'чекає відповіді' : WORD[w.kind]}, {ago(w.activityAt, now)}
            </Text>
          </Button>
          {g.key === 'done' && (
            <Button key={`ack-${w.id}`} plain onPress={() => void seen($, [w.id])}>
              ок
            </Button>
          )}
        </Box>
        <Box paddingLeft={2}>
          <Text dimColor>
            {r.name}
            {w.prNumber ? ` · PR ${w.prNumber}` : ''}
          </Text>
        </Box>
      </Box>
    )
    const lists = (
      <Box flexDirection="column" gap={1}>
        {groups.map(g => (
          <Box flexDirection="column">
            <Text bold color={g.color}>
              {g.title} · {g.items.length}
            </Text>
            {g.items.map(x => item(g, x))}
          </Box>
        ))}
        {groups.length === 0 && <Text dimColor>Немає сесій у роботі чи тих, що чекають.</Text>}
      </Box>
    )

    // cells per scene px; the drawing is as wide as the pane
    const cols = (e.props.bodyColumns ?? 76) + EXTRA_COLS
    const k = scene ? cols / scene.width : 0
    const slotPx = Math.round(cols * CELL_PX)
    const slotH = scene ? Math.round((slotPx * scene.height) / scene.width) : 0
    const cellX = (x: number) => Math.max(0, Math.round(x * k))
    const cellY = (y: number) => Math.max(0, Math.round((y * k) / ROW_RATIO))

    const hit = (sp: Spot) => (
      <Box position="absolute" top={Math.max(0, cellY(sp.y) - 1)} left={Math.max(0, cellX(sp.x) - 2)} flexDirection="column">
        {[0, 1].map(j => (
          <Button key={`hit-${sp.id}-${j}`} plain onPress={() => void pick($, sp.id)}>
            {v.debug ? '▓▓▓▓' : BLANK}
          </Button>
        ))}
      </Box>
    )

    const tag = (lb: Label) => (
      <Box position="absolute" top={Math.max(0, cellY(lb.y))} left={cellX(lb.x)} flexDirection="column">
        <Button key={`room-${lb.key}`} plain onPress={() => void goRoom($, v.room === lb.key ? '' : lb.key)}>
          {lb.name}
        </Button>
        {lb.sub && <Text dimColor>{lb.sub}</Text>}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={2}>
          <Text dimColor>
            {summary(shown)}
            {m.muted ? ' · сповіщення вимкнено' : ''}
          </Text>
          {wait.length > 0 && (
            <Button key="seen-all" plain onPress={() => void seen($, wait.map(w => w.id))}>
              усі побачені
            </Button>
          )}
        </Box>
        {v.debug && <Text dimColor>Режим перевірки: ▓ — області кліку по працівниках. /office debug вимикає.</Text>}
        {o.error && <Text color="red">Помилка опиту: {o.error}</Text>}
        {o.at === 0 && !o.error && <Text dimColor>Чекаю перший опит…</Text>}

        {active.length > 1 && (
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            <Button key="room-all" variant={room ? 'secondary' : 'primary'} onPress={() => void goRoom($, '')}>
              Весь офіс
            </Button>
            {active.map(r => (
              <Button key={`go-${r.key}`} variant={room?.key === r.key ? 'primary' : 'secondary'} onPress={() => void goRoom($, r.key)}>
                {`${r.name} · ${r.workers.length}`}
              </Button>
            ))}
          </Box>
        )}

        {Svg && scene ? (
          <Box flexDirection="column" gap={1}>
            <Box position="relative">
              <Svg
                source={scene.svg}
                alt={`Офіс: ${shown.length} кімнат; працюють ${count('work')}, чекають ${count('wait')}, відпочивають ${count('rest')}`}
                width={slotPx}
                height={slotH}
                isInteractive
              />
              {scene.spots.map(hit)}
              {scene.labels.map(tag)}
            </Box>
            {scene.hiddenRooms > 0 && <Text dimColor>Ще кімнат не показано: {scene.hiddenRooms}</Text>}
            {!room && quiet > 0 && <Text dimColor>Проєктів без активності (усі сесії вдома): {quiet}</Text>}
            {lists}
          </Box>
        ) : (
          // no drawing surface (terminal): the roster says the same in words
          <Box flexDirection="column" gap={1}>
            {shown.map(r => (
              <Box flexDirection="column">
                <Text bold>
                  {r.name}
                  {r.prNumbers.length ? `  PR ${r.prNumbers.join(', ')}` : ''}
                  {r.homeCount ? `  · вдома: ${r.homeCount}` : ''}
                </Text>
                {r.workers.map(row)}
              </Box>
            ))}
          </Box>
        )}

        {/* the card goes last, below the drawing: opening it must not push the picture down */}
        {chosen && (
          <Box flexDirection="column" borderStyle="round" paddingX={1}>
            <Text bold>{chosen.w.title}</Text>
            <Text dimColor>
              {chosen.r.name}
              {chosen.w.prNumber ? ` · PR ${chosen.w.prNumber}` : ''} · {WORD[chosen.w.kind]}, {ago(chosen.w.activityAt, now)}
              {chosen.w.parentId ? ' · стажер' : ''}
            </Text>
            <Box flexDirection="row" gap={1}>
              {e.surface !== 'mobile' && (
                <Button key="go-chat" variant="primary" onPress={() => void openChat($, chosen.w.link)}>
                  Перейти в чат
                </Button>
              )}
              {chosen.w.kind === 'wait' && (
                <Button key="card-ack" onPress={() => void seen($, [chosen.w.id])}>
                  ок, бачив
                </Button>
              )}
              <Button key="card-close" plain onPress={() => void pick($, chosen.w.id)}>
                закрити
              </Button>
            </Box>
            {v.note && <Text color="red">{v.note}</Text>}
          </Box>
        )}
      </Box>
    )
  })
}
