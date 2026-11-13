import type { Kind, Memory, RawSession, Room, Worker } from '../types'

export const WAIT_MS = 30 * 60 * 1000
/** Idle this long and a session goes home; a project with no session newer than this is not drawn at all. */
export const HOME_MS = 72 * 60 * 60 * 1000

export const emptyMemory = (): Memory => ({ ready: false, muted: false, sessions: {} })

/** Parses the text of list_sessions; throws with a short reason when it is not the expected list. */
export function parseSessions(text: string): RawSession[] {
  const data: unknown = JSON.parse(text)
  if (!Array.isArray(data)) throw new Error('list_sessions did not return a list')
  return data.filter(
    (s): s is RawSession =>
      !!s && typeof s === 'object' && typeof (s as RawSession).sessionId === 'string',
  )
}

const GENERIC = new Set(['server', 'app', 'src', 'docs', 'web', 'client', 'backend', 'frontend', 'api'])

const norm = (cwd: string) => cwd.replace(/\\/g, '/').replace(/\/+$/, '')

export function roomOf(cwd: string | undefined): { key: string; name: string; type: Room['type'] } {
  const p = norm(cwd ?? '')
  if (p === '' || p.includes('scratch-workspaces')) return { key: '#cowork', name: 'коворкінг', type: 'cowork' }
  if (p.startsWith('/')) return { key: '#remote', name: 'віддалений офіс', type: 'remote' }
  const parts = p.split('/').filter(Boolean)
  const last = parts[parts.length - 1] ?? p
  const name = GENERIC.has(last.toLowerCase()) && parts.length > 1 ? `${parts[parts.length - 2]}/${last}` : last
  return { key: p.toLowerCase(), name, type: 'project' }
}

export type OfficeEvent = { id: string; title: string; type: 'finished' }

export type Classified = { rooms: Room[]; memory: Memory; events: OfficeEvent[] }

const ORDER: Record<Kind, number> = { work: 0, wait: 1, rest: 2, home: 3 }

/** One poll: raw sessions + what we remembered -> rooms of workers, the new memory and who just finished. */
export function classify(raw: RawSession[], prev: Memory, now: number): Classified {
  const live = raw.filter(s => !s.isArchived)
  const ids = new Set(live.map(s => s.sessionId))
  // chats started from another one that are still running: that other one, if it has stopped, waits for them
  const running = new Map<string, { id: string; title: string; on?: string }[]>()
  for (const s of live) {
    if (s.isRunning && s.startedBy && ids.has(s.startedBy)) {
      running.set(s.startedBy, [...(running.get(s.startedBy) ?? []), { id: s.sessionId, title: s.title }])
    }
  }
  const sessions: Memory['sessions'] = {}
  const events: OfficeEvent[] = []
  const workers: { worker: Worker; room: ReturnType<typeof roomOf>; pr?: number; cwd?: string }[] = []

  // what a chat waits for: the chats it started that still run, and the colleague it asked and has not heard from
  const waits = (s: RawSession) => {
    const all = [...(running.get(s.sessionId) ?? []), ...(s.waitsFor ?? [])]
    return all.filter((x, i) => all.findIndex(y => y.id === x.id && y.on === x.on) === i)
  }

  for (const s of live) {
    const before = prev.sessions[s.sessionId]
    let entry: Memory['sessions'][string]
    if (s.isRunning) {
      entry = { running: true }
    } else if (before?.running && prev.ready) {
      entry = { running: false, finishedAt: now }
      events.push({ id: s.sessionId, title: s.title, type: 'finished' })
    } else {
      entry = { running: false, finishedAt: before?.finishedAt, isAcked: before?.isAcked }
    }
    const activityAt = Date.parse(s.lastActivityAt) || 0
    let kind: Kind
    if (s.isRunning) kind = 'work'
    else if (entry.finishedAt !== undefined && !entry.isAcked && now - entry.finishedAt < WAIT_MS) kind = 'wait'
    else kind = now - activityAt > HOME_MS ? 'home' : 'rest'

    // when the kind last changed and what it was before: the floor plays the move for a few seconds
    const same = before?.kind === kind
    const since = same ? (before?.since ?? now) : now
    const prevKind = same ? before?.prevKind : before?.kind
    sessions[s.sessionId] = { ...entry, kind, since, ...(prevKind ? { prevKind } : {}) }

    workers.push({
      room: roomOf(s.cwd),
      cwd: s.cwd,
      pr: s.prState === 'OPEN' ? s.prNumber : undefined,
      worker: {
        id: s.sessionId,
        title: s.title,
        link: s.link ?? `claude://claude.ai/epitaxy/${s.sessionId}`,
        kind,
        activityAt,
        changedAt: since,
        ...(prevKind ? { prevKind } : {}),
        prNumber: s.prState === 'OPEN' ? s.prNumber : undefined,
        ...(s.needsAnswer ? { needsAnswer: true, ...(s.askedAt ? { askedAt: s.askedAt } : {}) } : {}),
        ...(!s.isRunning && waits(s).length ? { waitsFor: waits(s) } : {}),
        // a running chat is past its failed turn: only one that has stopped is in error
        ...(s.error && !s.isRunning ? { error: s.error } : {}),
        parentId: s.startedBy && ids.has(s.startedBy) ? s.startedBy : undefined,
        ...(s.plan?.length ? { plan: s.plan } : {}),
        ...(s.weight ? { size: s.weight.size, haze: s.weight.haze } : {}),
      },
    })
  }

  const byKey = new Map<string, Room>()
  for (const { worker, room, pr, cwd } of workers) {
    let r = byKey.get(room.key)
    if (!r) {
      r = { key: room.key, name: room.name, type: room.type, workers: [], homeCount: 0, prNumbers: [], ...(room.type === 'project' && cwd ? { cwd } : {}) }
      byKey.set(room.key, r)
    }
    if (worker.kind === 'home') r.homeCount++
    else r.workers.push(worker)
    if (pr !== undefined && !r.prNumbers.includes(pr)) r.prNumbers.push(pr)
  }

  const rooms = [...byKey.values()]
  for (const r of rooms) {
    r.workers.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || b.activityAt - a.activityAt)
  }
  const rank = (r: Room) => (r.workers.length ? Math.min(...r.workers.map(w => ORDER[w.kind])) : 9)
  const last = (r: Room) => Math.max(0, ...r.workers.map(w => w.activityAt))
  rooms.sort((a, b) => rank(a) - rank(b) || last(b) - last(a))

  // sessions that vanished from the list drop out of memory by not being copied.
  return { rooms, memory: { ready: true, muted: prev.muted, sessions }, events }
}

/** The person looked at a finished worker: it goes back to resting. */
export function ack(mem: Memory, id: string): Memory {
  const one = mem.sessions[id]
  if (!one) return mem
  return { ...mem, sessions: { ...mem.sessions, [id]: { ...one, isAcked: true } } }
}

export type GroupKey = 'err' | 'ask' | 'agent' | 'work' | 'done'

export const RED = '#E5534B'

export type Group = { key: GroupKey; title: string; color: string; items: { w: Worker; room: Room }[] }

// red is a failure, orange asks for attention, soft blue is busy, soft green is finished; mid tones that read on a
// light and a dark theme. A chat is in one list only: a failure outranks the rest.
const GROUP_DEFS: { key: GroupKey; title: string; color: string; has: (w: Worker) => boolean }[] = [
  { key: 'err', title: 'З помилкою', color: RED, has: w => !!w.error },
  { key: 'ask', title: 'Потребують відповіді', color: '#E8943A', has: w => !w.error && !!w.needsAnswer },
  { key: 'agent', title: 'Чекають іншого агента', color: '#A98BE0', has: w => !w.error && !w.needsAnswer && !!w.waitsFor },
  { key: 'work', title: 'У роботі', color: '#6FA8DC', has: w => !w.error && !w.needsAnswer && !w.waitsFor && w.kind === 'work' },
  { key: 'done', title: 'Завершені, чекають', color: '#7FBF8E', has: w => !w.error && !w.needsAnswer && !w.waitsFor && w.kind === 'wait' },
]

/** The list a chat is in, if any: its colour is the one the chat is drawn in, whatever the theme. */
export const groupKeyOf = (w: Worker): GroupKey | undefined => GROUP_DEFS.find(d => d.has(w))?.key

export const GROUP_COLOR = Object.fromEntries(GROUP_DEFS.map(d => [d.key, d.color])) as Record<GroupKey, string>

/** The sessions of the given rooms in the three lists the pane shows, in that order; a list with nobody in it is left out. */
export function groupSessions(rooms: Room[]): Group[] {
  const all = rooms.flatMap(room => room.workers.map(w => ({ w, room })))
  return GROUP_DEFS.map(d => ({
    key: d.key,
    title: d.title,
    color: d.color,
    items: all.filter(x => d.has(x.w)).sort((a, b) => b.w.activityAt - a.w.activityAt),
  })).filter(g => g.items.length > 0)
}

export const WORD: Record<Kind, string> = {
  work: 'працює',
  wait: 'закінчив, чекає',
  rest: 'відпочиває',
  home: 'вдома',
}

export const ago = (ms: number, now: number): string => {
  const m = Math.max(0, Math.round((now - ms) / 60000))
  return m < 1 ? 'щойно' : m < 60 ? `${m} хв` : m < 1440 ? `${Math.round(m / 60)} год` : `${Math.round(m / 1440)} д`
}

/** "щойно" or "12 хв тому". */
export const agoText = (ms: number, now: number): string => {
  const t = ago(ms, now)
  return t === 'щойно' ? t : `${t} тому`
}

export function summary(rooms: Room[]): string {
  let work = 0
  let wait = 0
  let failed = 0
  for (const r of rooms) {
    for (const w of r.workers) {
      w.kind === 'work' ? work++ : w.kind === 'wait' ? wait++ : 0
      if (w.error) failed++
    }
  }
  return `працюють ${work}, чекають ${wait}${failed ? `, з помилкою ${failed}` : ''}`
}
