import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Detail, DetailState, ErrorCache, Memory, Office, RawSession, Room, SketchCache, ThemeChoice, View, Worker } from '../types'
import { hasLiveAgent } from './agents'
import { ack, ago, agoText, byProject, classify, emptyMemory, GROUP_COLOR, GROUP_MARK, groupSessions, parseSessions, RED, summary, WORD } from './data'
import type { Group } from './data'
import { askText, decisionText, detailRows, detailScript, mcpName, parseDetail, tasksText, waitsText } from './detail'
import { currentSvg } from './current'
import { errorLabel, errorOf, errorsScript, needsCheck, nextCache, parseErrors, parsePeers, peerOf, waitOf } from './errors'
import { floorSvg } from './floor'
import { galaxySvg, REST_COLOR, steady } from './galaxy'
import { legend } from './legend'
import { claudeDir } from './paths'
import { planProgress } from './plan'
import { DEFAULT_SETTINGS, parseSettings, serializeSettings, settingsPath, THEMES } from './settings'
import { needsSketch, nextSketches, parseSketches, sketchLook, sketchOffset, sketchScript, withSketches } from './sketch'
import type { Label, Spot } from './floor'
import { ICON_H, ICON_W, iconSvg } from './icons'
import { tipSvg } from './tip'
import type { IconKind } from './icons'

const PANE = 'iso-office'
const TITLE = 'Office'
const POLL_MS = 5000

// How the pane lays out its cells, measured on the desktop from the user's screenshots: a cell is ~7.5 px wide and
// ~20 px tall (2.65 times as tall), and the drawing fills the pane's width plus ~0.6 of a cell. Overlaid buttons are
// placed in these cells.
const ROW_RATIO = 2.65
const EXTRA_COLS = 0.6
const CELL_PX = 7.54 // css px per cell, measured
// A Box's margin is not counted in rows of text on the desktop: a margin cell there is half a row (~10 px against ~20).
// Measured from a screenshot at 125%: a margin of -20 cells moved the row up 248 px of a 500 px band.
const MARGIN_PER_ROW = 2
// a button label that draws nothing and is not whitespace (a plain space is trimmed away): braille blank
const BLANK = '⠀⠀⠀⠀'

const memory = atom({ plugin: 'iso-office', key: 'memory' } as const, emptyMemory(), { shape: 'memory-2' })
const office = atom({ plugin: 'iso-office', key: 'office' } as const, { at: 0, rooms: [] } as Office, {
  shape: 'office-2',
})
const view = atom({ plugin: 'iso-office', key: 'view' } as const, { room: '', selected: '', note: '', debug: false } as View, {
  shape: 'view-4',
})

const detail = atom({ plugin: 'iso-office', key: 'detail' } as const, { id: '', at: 0, loading: false } as DetailState, {
  shape: 'detail-1',
})

// which chats have been read for an error, and when: a transcript is read once per activity, not once per poll
const errors = atom({ plugin: 'iso-office', key: 'errors' } as const, {} as ErrorCache, { shape: 'errors-1' })

// what has been read of each chat's transcript so far: its task list and its tokens, for the galaxies
const sketches = atom({ plugin: 'iso-office', key: 'sketches' } as const, {} as SketchCache, { shape: 'sketches-2' })

// the open chat's details are fetched again when older than this (cost moves at the end of each turn)
const DETAIL_TTL_MS = 30000
// ...and sooner while one of its helper agents is at work, so that «what it is doing» is not half a minute late
const LIVE_DETAIL_TTL_MS = 8000

// a poll that has not answered in this long is taken for lost, so one hung call cannot stop the office for good
const STUCK_MS = 20000
// after a turn starts or ends the app takes a moment to flip `isRunning`: ask once more shortly after
const SETTLE_MS = 1500

// drawing the pane asks for a fresh poll, at most this often: switching to a chat draws its pane, and the timer of a
// chat that was in the background may not have run while the person was elsewhere
const RENDER_POLL_MS = 1500

// the pane is drawn again at every step of the scroll: the picture is handed on unchanged unless it really changed,
// or the host would make it anew each time (it blinks)
const steadyGalaxy = steady<ReturnType<typeof galaxySvg>>()
const steadyFloor = steady<ReturnType<typeof floorSvg>>()

let isPolling = false
let lastStatus = ''
// when each chat's details were last fetched: kept here, not in the pane's state, which would redraw it at every fetch
const detailFetchedAt = new Map<string, number>()
let isCheckingErrors = false
let isSketching = false
// when each chat's transcript was last read for its task list: a running chat is not read at every poll
const sketchReadAt = new Map<string, number>()
let lastRenderPollAt = 0
let pollStartedAt = 0
let lastPollAt = 0
let ticker: Timer | undefined

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content.map(b => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '')).join('')
    : String(content)

/**
 * Activity times to five minutes: a running session moves its time all the time, and every write the pane reads makes it
 * draw again. Nothing on screen needs the time more exactly than that (the terminal roster says "5 хв").
 */
const ACTIVITY_STEP_MS = 5 * 60000
const quantize = (rooms: Room[]): Room[] =>
  rooms.map(r => ({
    ...r,
    workers: r.workers.map(w => ({ ...w, activityAt: Math.floor(w.activityAt / ACTIVITY_STEP_MS) * ACTIVITY_STEP_MS })),
  }))

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

/** Claude's folder: CLAUDE_CONFIG_DIR says where it was moved to, else the home folder has it. Nothing known: undefined. */
async function claudeBase($: EngineInterface): Promise<string | undefined> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  return claudeDir({ configDir: configDir || undefined, home: home || undefined })
}

/**
 * Ids of the chats that are blocked on the person. list_sessions does not say so, but each running chat keeps a
 * registry file (~/.claude/sessions/<pid>.json) with its `status` and its app id; `waiting` is a permission or a question.
 * Anything unreadable counts as nobody: the list then has no "need an answer" group, nothing else changes.
 */
async function waitingSessions($: EngineInterface): Promise<Map<string, number>> {
  const ids = new Map<string, number>()
  try {
    // Claude's folder may have been moved to another disk
    const base = await claudeBase($)
    if (!base) return ids
    const dir = `${base}/sessions`
    const files = (await $.fs.list(dir)).filter(f => /^\d+\.json$/.test(f.name))
    await Promise.all(
      files.map(async f => {
        try {
          const j: unknown = JSON.parse(await $.fs.read(`${dir}/${f.name}`))
          const o = j as { status?: unknown; hostSessionId?: unknown; statusUpdatedAt?: unknown }
          if (o && o.status === 'waiting' && typeof o.hostSessionId === 'string') {
            ids.set(o.hostSessionId, typeof o.statusUpdatedAt === 'number' ? o.statusUpdatedAt : 0)
          }
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

/**
 * Reads the end of the transcripts of the chats that stopped or changed since they were last read, to see whether their
 * last reply was an API error (a refused sign-in, a server fault). One PowerShell run for all of them, off the poll's
 * way: when it has found something the poll is made again to show it. A failed run is remembered as "no error" until the
 * chat changes, so a broken shell is not started every five seconds.
 */
async function refreshErrors($: EngineInterface, listed: RawSession[], cache: ErrorCache) {
  if (isCheckingErrors) return
  const todo = needsCheck(listed, cache, Date.now())
  // chats that left the list are forgotten
  const hasGone = Object.keys(nextCache(cache, listed, [], {})).length !== Object.keys(cache).length
  if (todo.length === 0 && !hasGone) return
  isCheckingErrors = true
  try {
    let found: ReturnType<typeof parseErrors> = {}
    let asks: ReturnType<typeof parsePeers> = {}
    if (todo.length > 0) {
      try {
        const r = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', errorsScript(todo.map(s => s.sessionId))], {
          timeoutMs: 30000,
        })
        if (r.exitCode === 0) {
          found = parseErrors(r.stdout)
          asks = parsePeers(r.stdout)
        }
      } catch {
        // no shell, or it timed out: nothing found
      }
    }
    const merged = nextCache(cache, listed, todo, found, asks)
    if (JSON.stringify(merged) !== JSON.stringify(cache)) {
      await update($, errors, () => merged)
      // an error or a wait found (or cleared) changes what the poll shows
      const failedIn = (c: ErrorCache) =>
        JSON.stringify(Object.entries(c).filter(([, e]) => e.error || e.peer).map(([id, e]) => [id, e.at, !!e.error, !!e.peer]).sort())
      if (failedIn(merged) !== failedIn(cache)) void poll($)
    }
  } finally {
    isCheckingErrors = false
  }
}

/**
 * Reads the transcripts of the chats on screen for their task list and tokens, each from where the last read stopped. One
 * PowerShell run for all, off the poll's way: when what it found changes the drawing, the poll is made again to show it.
 * A chat not read to the end is read on at the next poll.
 */
async function refreshSketches($: EngineInterface, listed: RawSession[], cache: SketchCache) {
  if (isSketching) return
  const now = Date.now()
  const todo = needsSketch(listed, cache, now, sketchReadAt)
  const hasGone = Object.keys(nextSketches(cache, listed, [], {})).length !== Object.keys(cache).length
  if (todo.length === 0 && !hasGone) return
  isSketching = true
  try {
    let found: ReturnType<typeof parseSketches> = {}
    if (todo.length > 0) {
      for (const s of todo) sketchReadAt.set(s.sessionId, now)
      try {
        const items = todo.map(s => ({ id: s.sessionId, offset: sketchOffset(cache[s.sessionId]) }))
        const r = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', sketchScript(items)], { timeoutMs: 40000 })
        if (r.exitCode === 0) found = parseSketches(r.stdout)
      } catch {
        // no shell, a session id it would not take, or it timed out: nothing found
      }
    }
    const merged = nextSketches(cache, listed, todo, found)
    if (JSON.stringify(merged) !== JSON.stringify(cache)) {
      await update($, sketches, () => merged)
      if (sketchLook(merged) !== sketchLook(cache)) void poll($)
    }
  } finally {
    isSketching = false
  }
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
    const failed = await read($, errors)
    const seenSketches = await read($, sketches)
    const raw = withSketches(listed, seenSketches).map(s => {
      const since = asking.get(s.sessionId)
      const error = errorOf(failed, s)
      const ask = peerOf(failed, s)
      const asked = ask && !s.isRunning ? waitOf(ask, listed) : undefined
      return {
        ...s,
        ...(asked ? { waitsFor: [asked] } : {}),
        ...(since === undefined ? {} : { needsAnswer: true, ...(since ? { askedAt: since } : {}) }),
        ...(error ? { error } : {}),
      }
    })
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
    const status = `Office: ${summary(rooms)}`
    if (status !== lastStatus) {
      lastStatus = status
      void $.ui.status(status)
    }
    void refreshErrors($, listed, failed)
    void refreshSketches($, listed, seenSketches)

    // the open chat's accordion: fetched again when it is not the chat held, or when its numbers have grown old
    // (a fetch that has not finished in that time is taken for lost, and is made again)
    const chosenId = (await read($, view)).selected
    if (chosenId) {
      const held = await read($, detail)
      const ttl = held.id === chosenId && hasLiveAgent(held.data?.agents, Date.now()) ? LIVE_DETAIL_TTL_MS : DETAIL_TTL_MS
      if (held.id !== chosenId || Date.now() - (detailFetchedAt.get(chosenId) ?? 0) > ttl) void loadDetail($, chosenId)
    }

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
// icons as plain glyphs, where there is no drawing to hold their tooltips
const GLYPH: Record<IconKind, string> = { open: '↗', seen: '✓', add: '+' }

async function seen($: EngineInterface, ids: string[]) {
  await update($, memory, m => ids.reduce((acc, id) => ack(acc, id), m) as Memory)
  void poll($)
}

/** A tool's answer as JSON, or nothing: a detail that cannot be read is simply left out of the accordion. */
async function toolJson($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  try {
    const r = await $.mcp.call('ccd_session_mgmt', tool, args)
    if (r.isError) return undefined
    const j: unknown = JSON.parse(textOf(r.content))
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** What the app keeps on disk about the chat (cost, tokens, turns), read by a short PowerShell run. */
async function diskDetail($: EngineInterface, id: string): Promise<Detail> {
  try {
    const r = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', detailScript(id)], { timeoutMs: 20000 })
    return r.exitCode === 0 ? parseDetail(r.stdout) : {}
  } catch {
    return {}
  }
}

const strOf = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const numOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Collects everything the accordion shows for one chat; what the app does not give is left out, never guessed. */
async function loadDetail($: EngineInterface, id: string) {
  detailFetchedAt.set(id, Date.now())
  const held = await read($, detail)
  if (held.id !== id) await update($, detail, () => ({ id, at: Date.now(), loading: true }))
  try {
    const [sess, usage, disk] = await Promise.all([
      toolJson($, 'get_session', { session_id: id }),
      toolJson($, 'get_usage', { session_id: id }),
      diskDetail($, id),
    ])
    const data: Detail = { ...disk }
    // the app's live answer outranks the copy on disk
    if (sess) {
      const put = <K extends keyof Detail>(k: K, v: Detail[K] | undefined) => {
        if (v !== undefined) data[k] = v
      }
      put('model', strOf(sess.model))
      put('effort', strOf(sess.effort))
      put('permissionMode', strOf(sess.permissionMode))
      put('branch', strOf(sess.branch))
      put('cwd', strOf(sess.cwd))
      put('prState', strOf(sess.prState))
      put('prNumber', numOf(sess.prNumber))
      const created = typeof sess.createdAt === 'string' ? Date.parse(sess.createdAt) : NaN
      if (Number.isFinite(created)) data.createdAt = created
    }
    const ctx = usage?.context as Record<string, unknown> | undefined
    if (ctx && ctx.status === 'ok' && numOf(ctx.tokensUsed) !== undefined && numOf(ctx.contextWindow)) {
      data.context = { used: numOf(ctx.tokensUsed)!, window: numOf(ctx.contextWindow)!, percent: numOf(ctx.percentUsed) ?? 0 }
    }
    // the person may have moved on while this was being read
    if ((await read($, view)).selected !== id) return
    // write only what changed: a write the pane reads draws it again, and a fetch that found the same numbers is not news
    const cur = await read($, detail)
    if (cur.id !== id || cur.loading || JSON.stringify(cur.data) !== JSON.stringify(data)) {
      await update($, detail, () => ({ id, at: Date.now(), loading: false, data }))
    }
  } catch {
    const cur = await read($, detail)
    if (cur.id === id && cur.loading) await update($, detail, () => ({ id, at: Date.now(), loading: false, ...(cur.data ? { data: cur.data } : {}) }))
  }
}

/** Opens a chat's accordion, or closes it when it is the open one. */
async function pick($: EngineInterface, id: string) {
  const opening = (await read($, view)).selected !== id
  await update($, view, v => ({ ...v, selected: opening ? id : '', note: '' }))
  if (opening) void loadDetail($, id)
}

const goRoom = ($: EngineInterface, key: string) => update($, view, v => ({ ...v, room: key, note: '' }))

const goTab = ($: EngineInterface, tab: NonNullable<View['tab']>) => update($, view, v => ({ ...v, tab, note: '' }))

/**
 * The link that opens a new session in a folder: the app's own `claude://code/new?folder=…`, the one its «New Claude Code
 * Session» menu entry uses. The folder goes as the session gives it (backslashes and all): the app asks whether to trust
 * a folder it does not know by that very spelling. Nothing but unreserved characters and %XX reaches the shell.
 */
const newSessionLink = (folder: string): string =>
  `claude://code/new?folder=${encodeURIComponent(folder).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`

/** Where a «+» can start a session: a project with a folder, and the coworking room. */
const canStartIn = (room: Room | undefined): room is Room => !!room && ((room.type === 'project' && !!room.cwd) || room.type === 'cowork')

/** Starts a new session in a project's folder: the «+» beside a project's name. The app opens it, ready for the first message. */
async function newSession($: EngineInterface, room: Room) {
  // a project is opened in its folder; the coworking room has none, and the app starts a session where it starts one when
  // it is not told (the link without a folder); a remote office has a folder on another machine: not from here
  if (!canStartIn(room)) return
  const link = room.type === 'project' ? newSessionLink(room.cwd!) : 'claude://code/new'
  if (!/^claude:\/\/code\/new(\?folder=[A-Za-z0-9._~%-]+)?$/.test(link)) {
    await update($, view, v => ({ ...v, note: 'Не вдалося відкрити нову сесію: тека не розпізнана.' }))
    return
  }
  try {
    const r = await $.process.run(['cmd', '/c', 'start', '', link])
    await update($, view, v => ({ ...v, note: r.exitCode === 0 ? '' : `Не вдалося відкрити нову сесію (код ${r.exitCode}).` }))
  } catch (err) {
    await update($, view, v => ({ ...v, note: `Не вдалося відкрити нову сесію: ${String(err).slice(0, 100)}` }))
  }
}

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

/**
 * Takes the settings from their file into the pane. A file that is not there (the first run) or cannot be read leaves the
 * pane as it is, in the defaults; the file is made when the person first changes something.
 */
async function loadSettings($: EngineInterface) {
  try {
    const base = await claudeBase($)
    if (!base) return
    const { theme } = parseSettings(await $.fs.read(settingsPath(base)))
    await update($, view, v => ({ ...v, theme }))
  } catch {
    // no file yet, or it cannot be read: the defaults stand
  }
}

/** Writes the settings to their file; the pane says so under the picture when that fails, and the choice still holds for the session. */
async function saveSettings($: EngineInterface, theme: ThemeChoice) {
  try {
    const base = await claudeBase($)
    if (!base) throw new Error('теку Claude не знайдено')
    await $.fs.write(settingsPath(base), serializeSettings({ ...DEFAULT_SETTINGS, theme }))
  } catch (err) {
    await update($, view, v => ({ ...v, note: `Не вдалося зберегти налаштування: ${String(err instanceof Error ? err.message : err).slice(0, 100)}` }))
  }
}

/** Chooses how the work is drawn, for now and for the next start. */
async function setTheme($: EngineInterface, theme: ThemeChoice) {
  await update($, view, v => ({ ...v, theme, note: '' }))
  await saveSettings($, theme)
}

const waiting = (rooms: Room[]) => rooms.flatMap(r => r.workers.filter(w => w.kind === 'wait'))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'office', description: 'Office pane: /office [mute|unmute|seen|legend|settings|theme [none|office|galaxy]]' })
    await loadSettings($)
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
    if (arg === 'theme' || arg.startsWith('theme ')) {
      const asked = arg.slice(5).trim()
      if (asked !== '' && asked !== 'none' && asked !== 'office' && asked !== 'galaxy') return { text: 'Themes: none, office, galaxy. /office theme alone switches.' }
      const now = (await read($, view)).theme ?? 'galaxy'
      // without a name it goes between the galaxies and the office (from no picture, to the galaxies)
      const next: ThemeChoice = asked !== '' ? asked : now === 'galaxy' ? 'office' : 'galaxy'
      await setTheme($, next)
      return { text: next === 'galaxy' ? 'Theme: galaxies.' : next === 'office' ? 'Theme: office.' : 'Theme: none.' }
    }
    if (arg === 'settings') {
      await goTab($, 'settings')
      await open($)
      return { text: 'Settings tab opened.' }
    }
    if (arg === 'legend') {
      await goTab($, 'legend')
      await open($)
      return { text: 'Legend tab opened.' }
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
    const theme: ThemeChoice = v.theme ?? 'galaxy'
    const isGalaxy = theme === 'galaxy'
    // no picture asked for: the lists stand alone
    const isDrawn = theme !== 'none'
    const scene = Svg && isDrawn && shown.length > 0 ? (isGalaxy ? steadyGalaxy(galaxySvg(shown, now, v.selected)) : steadyFloor(floorSvg(shown, now, v.selected))) : undefined
    const count = (k: Worker['kind']) => shown.reduce((n, r) => n + r.workers.filter(w => w.kind === k).length, 0)

    const ds = await read($, detail)
    // the session this pane is open in: its row in the lists has a band behind it
    const me = await ownId($)

    // cells per scene px; the drawing is as wide as the pane
    const cols = (e.props.bodyColumns ?? 76) + EXTRA_COLS
    const slotPx = Math.round(cols * CELL_PX)
    const ROW_PX = CELL_PX * ROW_RATIO

    // an icon with a tooltip: a drawing carries the <title>, a clear Button over it takes the press; no drawing (the
    // terminal): a plain glyph
    const iconButton = (key: string, kind: IconKind, tip: string, onPress: () => void) =>
      Svg ? (
        <Box position="relative">
          <Svg source={iconSvg(kind, tip)} alt={tip} width={ICON_W} height={ICON_H} isInteractive />
          <Box position="absolute" top={0} left={0}>
            <Button key={key} plain onPress={onPress}>
              {BLANK}
            </Button>
          </Box>
        </Box>
      ) : (
        <Button key={key} plain onPress={onPress}>
          {GLYPH[kind]}
        </Button>
      )
    const openIcon = (w: Worker) =>
      e.surface !== 'mobile' && iconButton(`go-${w.id}`, 'open', 'Перейти в чат', () => void openChat($, w.link))
    const seenIcon = (w: Worker) =>
      iconButton(`ack-${w.id}`, 'seen', 'Позначити переглянутим', () => void seen($, [w.id]))

    // what opens under a chosen chat: its state and how long it has lasted, what it cost, its tokens, and the rest
    const accordion = (w: Worker, r: Room) => {
      const mine = ds.id === w.id ? ds : undefined
      const rows = detailRows(w, r, mine?.data, now)
      return (
        <Box flexDirection="column" paddingLeft={2}>
          {rows.map(([label, value, tone]) => (
            <Box flexDirection="row" gap={1}>
              <Box width={12}>
                <Text dimColor>{label}</Text>
              </Box>
              {tone === 'bad' ? <Text color={RED}>{value}</Text> : <Text>{value}</Text>}
            </Box>
          ))}
          {(!mine || mine.loading) && <Text dimColor>Завантажую деталі…</Text>}
          {mine?.data?.costUSD !== undefined && <Text dimColor>Вартість і токени — на кінець останнього ходу.</Text>}
        </Box>
      )
    }

    // how many rows the accordion takes: each detail, the note while it loads, the note on the cost. The band of the current
    // session is as tall as its row and its accordion together
    const accordionRows = (w: Worker, r: Room) => {
      const mine = ds.id === w.id ? ds : undefined
      return detailRows(w, r, mine?.data, now).length + (!mine || mine.loading ? 1 : 0) + (mine?.data?.costUSD !== undefined ? 1 : 0)
    }

    // the terminal roster: one line per chat, its accordion under it when chosen
    const row = (w: Worker, r: Room) => (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button key={`pick-${w.id}`} plain dimColor={w.kind === 'rest'} onPress={() => void pick($, w.id)}>
            {MARK[w.kind]} {w.parentId ? '↳ ' : ''}
            {w.title} — {w.error ? `помилка: ${errorLabel(w.error)}` : WORD[w.kind]}, {ago(w.activityAt, now)}
            {w.plan && w.plan.length > 0 ? ` · план ${planProgress(w.plan)}` : ''}
          </Button>
          {openIcon(w)}
          {w.kind === 'wait' && seenIcon(w)}
        </Box>
        {w.id === v.selected && accordion(w, r)}
      </Box>
    )

    // below the drawing: sessions in lists by state, each split by project, a title and, under it, the PR and plan; only the chosen project when one is.
    // The title is just the name (the group already says the state); the chosen one is bigger and bold.
    const groups = groupSessions(shown)
    const item = (g: { key: keyof typeof GROUP_MARK; color: string }, { w, room: r }: Group['items'][number]) => {
      const isOpen = w.id === v.selected
      const isMe = w.id === me
      // the lines the row takes (the title, the line under it, and each note), which the band behind it is as tall as
      const lines =
        2 +
        (isOpen ? 0.4 : 0) +
        (w.decision && !w.error ? 1 : 0) +
        (w.turnAsk && g.key === 'turn' ? 1 : 0) +
        (waitsText(w) && !w.error && !w.needsAnswer ? 1 : 0) +
        (w.mcp && !w.needsAnswer ? 1 : 0) +
        (w.tasks?.length && !w.error && !w.needsAnswer ? 1 : 0)
      // whole rows, since the row is drawn up over the band by a margin of whole cells (MARGIN_PER_ROW to a row)
      const bandRows = Math.max(1, Math.round(lines))
      // the band goes on behind the accordion of the open session, so that the gradient takes its details in too
      const spanRows = bandRows + (isOpen ? accordionRows(w, r) : 0)
      const head = (
        <Box flexDirection="column">
          <Button key={`pick-${w.id}`} plain onPress={() => void pick($, w.id)}>
            <Text color={g.color}>{GROUP_MARK[g.key]}</Text>
            {isOpen ? (
              <Text size="heading" weight="bold">{` ${w.parentId ? '↳ ' : ''}${w.title}`}</Text>
            ) : (
              <Text>{` ${w.parentId ? '↳ ' : ''}${w.title}`}</Text>
            )}
          </Button>
          <Box flexDirection="row" gap={1} paddingLeft={2}>
            <Text dimColor>
              {w.prNumber ? `PR ${w.prNumber}` : ''}
            </Text>
            {w.plan && w.plan.length > 0 && <Text dimColor>{`план ${planProgress(w.plan)}`}</Text>}
            {w.error && <Text color={RED}>{`${errorLabel(w.error)} · ${agoText(w.error.at, now)}`}</Text>}
            {openIcon(w)}
            {(g.key === 'done' || ((g.key === 'plan' || g.key === 'turn') && w.kind === 'wait')) && seenIcon(w)}
          </Box>
          {w.decision && !w.error && (
            <Box paddingLeft={2}>
              <Text color={g.color}>{`чекає рішення: ${decisionText(w.decision)}`}</Text>
            </Box>
          )}
          {w.turnAsk && g.key === 'turn' && (
            <Box paddingLeft={2}>
              <Text color={g.color}>{`питання: ${askText(w.turnAsk, 120)}`}</Text>
            </Box>
          )}
          {waitsText(w) && !w.error && !w.needsAnswer && (
            <Box paddingLeft={2}>
              <Text color={g.color}>{`чекає: ${waitsText(w)}`}</Text>
            </Box>
          )}
          {w.mcp && !w.needsAnswer && (
            <Box paddingLeft={2}>
              <Text color={GROUP_COLOR.agent}>{`чекає MCP: ${mcpName(w.mcp)}`}</Text>
            </Box>
          )}
          {!!w.tasks?.length && !w.error && !w.needsAnswer && (
            <Box paddingLeft={2}>
              <Text color={GROUP_COLOR.task}>{`чекає фонову задачу: ${tasksText(w)}`}</Text>
            </Box>
          )}
        </Box>
      )
      return (
        <Box flexDirection="column">
          {Svg && isMe && e.surface === 'desktop' ? (
            // The band is an ordinary drawing in the flow, and the row with its accordion is drawn up over it with a negative
            // margin of the band's whole height. It must not be an absolute box laid over the row: a drawing that is not
            // interactive is an image, and an image laid over the buttons takes the pointer from them (no hover, no press).
            // A row that wraps is taller than the estimate: the band then ends above its last line, nothing overlaps.
            // Only on the desktop, where the margin's cell was measured; elsewhere the row goes without a band.
            <Box flexDirection="column">
              <Svg source={currentSvg(slotPx, spanRows * ROW_PX)} alt="Поточна сесія" width={slotPx} height={Math.round(spanRows * ROW_PX)} />
              {/* the text is off the bar at the band's left edge */}
              <Box flexDirection="column" marginTop={-spanRows * MARGIN_PER_ROW} paddingLeft={1}>
                {head}
                {isOpen && accordion(w, r)}
              </Box>
            </Box>
          ) : (
            <Box flexDirection="column">
              {head}
              {isOpen && accordion(w, r)}
            </Box>
          )}
        </Box>
      )
    }
    const inLists = new Set(groups.flatMap(g => g.items.map(x => x.w.id)))
    // an idle session is in no list: the chosen one and the current one (this pane's own) are still shown, so that they can be found
    const idleShown = shown.flatMap(r => r.workers.map(w => ({ w, room: r }))).filter(x => (x.w.id === v.selected || x.w.id === me) && !inLists.has(x.w.id))
    const idleTitle = idleShown.some(x => x.w.id === me) ? (idleShown.some(x => x.w.id === v.selected && x.w.id !== me) ? 'Простоюють · поточна й обрана' : 'Простоює · поточна') : 'Простоює · обрана'
    const lists = (
      <Box flexDirection="column" gap={1}>
        {groups.map(g => (
          <Box flexDirection="column">
            <Text bold color={g.color}>
              {g.title} · {g.items.length}
            </Text>
            {byProject(g.items).map(p => (
              <Box flexDirection="column">
                <Text size="heading" weight="bold">{`${p.room.name} · ${p.items.length}`}</Text>
                {p.items.map(x => item(g, x))}
              </Box>
            ))}
          </Box>
        ))}
        {/* a session that merely idles is in no list, yet it can be pressed in the picture: its data open here */}
        {idleShown.length > 0 && (
          <Box flexDirection="column">
            <Text bold color={REST_COLOR}>
              {idleTitle}
            </Text>
            {idleShown.map(x => item({ key: 'rest', color: REST_COLOR }, x))}
          </Box>
        )}
        {groups.length === 0 && idleShown.length === 0 &&<Text dimColor>Немає сесій у роботі чи тих, що чекають.</Text>}
      </Box>
    )

    const k = scene ? cols / scene.width : 0
    const slotH = scene ? Math.round((slotPx * scene.height) / scene.width) : 0
    const cellX = (x: number) => Math.max(0, Math.round(x * k))
    const cellY = (y: number) => Math.max(0, Math.round((y * k) / ROW_RATIO))

    // the buttons laid over a star take the pointer, so the drawing's own <title> never shows under them: the name is a
    // card of the pane's own, shown while the pointer is on the spot (a hidden Box a hover turns on). The card is a small
    // drawing: a Box has square corners, a drawing has rounded ones, a thin white outline and a fade-in. It has a width
    // of its own: an absolute Box with none is given its parent's, a few cells, and the drawing is shrunk to it. The
    // spots are laid after the names of the galaxies, so that a card is over a name, not under it
    const hit = (sp: Spot) => {
      const card = sp.tip ? tipSvg(sp.tip) : undefined
      const at = Math.max(0, cellX(sp.x) - 2)
      const cardCols = card ? Math.ceil(card.width / CELL_PX) : 0
      // near the right edge the card opens leftwards, so that the pane does not cut it
      const shift = card && at + cardCols > cols ? Math.max(-at, 4 - cardCols) : 0
      return (
        <Box key={`spot-${sp.id}`} position="absolute" top={Math.max(0, cellY(sp.y) - 1)} left={at} flexDirection="column">
          {[0, 1].map(j => (
            <Button key={`hit-${sp.id}-${j}`} plain onPress={() => void pick($, sp.id)}>
              {v.debug ? '▓▓▓▓' : BLANK}
            </Button>
          ))}
          {card && sp.tip && (
            <Box position="absolute" top={2} left={shift} width={cardCols + 1} flexShrink={0} display="none" hover={{ display: 'flex' }}>
              <Svg source={card.svg} alt={sp.tip} width={card.width} height={card.height} isInteractive />
            </Box>
          )}
        </Box>
      )
    }

    // a name the drawing writes itself (the galaxies, on a dark sky) is pressed through an invisible button of its width
    // the «+» after a name starts a new session in the project. Both are real text of the pane, so that what is pressed is
    // what is seen; on a dark picture (the galaxies) they are drawn in light colours, as the pane's own would not read
    const LIGHT = '#DCE8FF'
    const tag = (lb: Label) => {
      const project = shown.find(r => r.key === lb.key)
      const canAdd = canStartIn(project)
      return (
        <Box position="absolute" top={Math.max(0, cellY(lb.y))} left={cellX(lb.x)} flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key={`room-${lb.key}`} plain onPress={() => void goRoom($, v.room === lb.key ? '' : lb.key)}>
              {lb.dark ? <Text bold color={LIGHT}>{lb.name}</Text> : lb.name}
            </Button>
            {canAdd && iconButton(`new-${lb.key}`, 'add', 'Нова сесія в проєкті', () => void newSession($, project!))}
          </Box>
          {lb.sub && (lb.dark ? <Text color="#8FA3CC">{lb.sub}</Text> : <Text dimColor>{lb.sub}</Text>)}
        </Box>
      )
    }

    // the tabs: the picture with its lists, the legend that explains every state, and the settings
    const tab = v.tab === 'legend' || v.tab === 'settings' ? v.tab : 'main'
    const tabs = (
      <Box flexDirection="row" gap={1}>
        <Button key="tab-main" variant={tab === 'main' ? 'primary' : 'secondary'} onPress={() => void goTab($, 'main')}>
          Огляд
        </Button>
        <Button key="tab-legend" variant={tab === 'legend' ? 'primary' : 'secondary'} onPress={() => void goTab($, 'legend')}>
          Легенда
        </Button>
        <Button key="tab-settings" variant={tab === 'settings' ? 'primary' : 'secondary'} onPress={() => void goTab($, 'settings')}>
          Налаштування
        </Button>
      </Box>
    )

    if (tab === 'settings') {
      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          <Text bold>Тема</Text>
          <Text dimColor>Як показувати сесії. Вибір записується у файл iso-office.json у теці Claude і діє й після перезапуску.</Text>
          {THEMES.map(t => (
            <Box flexDirection="column">
              <Button key={`theme-${t.key}`} variant={theme === t.key ? 'primary' : 'secondary'} onPress={() => void setTheme($, t.key)}>
                {theme === t.key ? `✓ ${t.title}` : t.title}
              </Button>
              <Box paddingLeft={2}>
                <Text dimColor>{t.hint}</Text>
              </Box>
            </Box>
          ))}
          {v.note && <Text color="red">{v.note}</Text>}
        </Box>
      )
    }

    if (tab === 'legend') {
      const L = legend(isGalaxy ? 'galaxy' : 'office')
      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          <Text dimColor>
            {isDrawn
              ? `Стани сесій і як їх видно ${isGalaxy ? 'в галактиках' : 'в офісі'}. Вигляд обирають на вкладці «Налаштування».`
              : 'Стани сесій. Графіку вимкнено: стан видно лише в списках. Вигляд обирають на вкладці «Налаштування».'}
          </Text>
          {L.states.map(s => (
            <Box flexDirection="row" gap={1}>
              <Box width={2}>
                <Text color={s.color}>{s.mark}</Text>
              </Box>
              <Box flexDirection="column">
                <Text bold color={s.color}>
                  {s.title}
                </Text>
                <Text>{s.means}</Text>
                {isDrawn && <Text dimColor>{s.looks}</Text>}
              </Box>
            </Box>
          ))}
          {isDrawn && <Text bold>Позначки</Text>}
          {isDrawn &&
            L.marks.map(mk => (
              <Box flexDirection="column">
                <Text>{mk.name}</Text>
                <Box paddingLeft={2}>
                  <Text dimColor>{mk.text}</Text>
                </Box>
              </Box>
            ))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {tabs}
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
            {/* in a fixed order: by activity the buttons would move under the pointer */}
            {[...active].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map(r => (
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
                alt={`${isGalaxy ? 'Галактики' : 'Офіс'}: ${shown.length} ${isGalaxy ? 'проєктів' : 'кімнат'}; працюють ${count('work')}, чекають ${count('wait')}, відпочивають ${count('rest')}`}
                width={slotPx}
                height={slotH}
                isInteractive
              />
              {scene.labels.map(tag)}
              {scene.spots.map(hit)}
            </Box>
            {scene.hiddenRooms > 0 && <Text dimColor>Ще {isGalaxy ? 'галактик' : 'кімнат'} не показано: {scene.hiddenRooms}</Text>}
            {!room && quiet > 0 && <Text dimColor>Проєктів без активності (усі сесії вдома): {quiet}</Text>}
            {lists}
          </Box>
        ) : Svg && !isDrawn ? (
          // no picture asked for: the lists alone
          <Box flexDirection="column" gap={1}>
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
                {r.workers.map(w => row(w, r))}
              </Box>
            ))}
          </Box>
        )}

        {v.note && <Text color="red">{v.note}</Text>}
      </Box>
    )
  })
}
