import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Memory, Office, Room, View, Worker } from '../types'
import { ack, ago, classify, emptyMemory, parseSessions, summary, WORD } from './data'
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

let isPolling = false

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content.map(b => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '')).join('')
    : String(content)

/** Activity times to the minute: a running session moves its time every poll, and the pane must not redraw for that. */
const quantize = (rooms: Room[]): Room[] =>
  rooms.map(r => ({ ...r, workers: r.workers.map(w => ({ ...w, activityAt: Math.floor(w.activityAt / 60000) * 60000 })) }))

async function poll($: EngineInterface) {
  if (isPolling) return
  isPolling = true
  try {
    const r = await $.mcp.call('ccd_session_mgmt', 'list_sessions', { limit: 100 })
    if (r.isError) throw new Error(textOf(r.content).slice(0, 200))
    const raw = parseSessions(textOf(r.content))
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
    if (!prev.muted && next.events.length > 0) {
      const names = next.events.map(e => e.title)
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
    isPolling = false
  }
}

const open = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE })

const MARK = { work: '▶', wait: '!', rest: '·', home: '' } as const

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
    void poll($)
    $.clock.every(POLL_MS, () => void poll($))
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
            {room ? shown.flatMap(r => r.workers).map(row) : wait.map(row)}
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
      </Box>
    )
  })
}
