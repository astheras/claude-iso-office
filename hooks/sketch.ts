import type { PlanItem, RawSession, Sketch, SketchCache } from '../types'
import { HOME_MS } from './data'
import { planFrom } from './plan'

/**
 * What the galaxies need from every chat on screen: its task list and its tokens. Transcripts run to tens of megabytes
 * and only grow at the end, so each is read in pieces from where the last read stopped, and a chat is read again only
 * when it has moved.
 */

/** How many chats one run reads, and how much of each (a piece ends at a line end, so no record is cut). */
export const MAX_SKETCHED = 12
export const CHUNK_BYTES = 8 * 1024 * 1024
/** A chat that is running moves all the time: it is read again at most this often. */
export const RUNNING_EVERY_MS = 20000

/** Steps of a chat's output tokens: the size of its star. */
export const sizeStep = (out: number): number => (out < 1e3 ? 0 : out < 1e4 ? 1 : out < 1e5 ? 2 : out < 5e5 ? 3 : 4)
/** Steps of how much its context holds: the size of its system, the more it holds the bigger. */
export const contextStep = (tokens: number): number => (tokens < 2e4 ? 0 : tokens < 6e4 ? 1 : tokens < 15e4 ? 2 : tokens < 4e5 ? 3 : 4)
/** Steps of what it has read from the cache: the cloud around its star. */
export const hazeStep = (cache: number): number => (cache < 1e5 ? 0 : cache < 1e6 ? 1 : cache < 1e7 ? 2 : 3)

/** The chats to read: on screen, and either never read, moved since, or not read to the end yet. */
export function needsSketch(raw: RawSession[], cache: SketchCache, now: number, readAt: Map<string, number> = new Map()): RawSession[] {
  return raw
    .filter(s => {
      if (s.isArchived) return false
      if (!s.isRunning && now - (Date.parse(s.lastActivityAt) || 0) >= HOME_MS) return false
      const c = cache[s.sessionId]
      if (c && c.at === s.lastActivityAt && c.offset >= c.size) return false
      // running chats move at every poll: not every poll is a reason to read
      if (c && s.isRunning && now - (readAt.get(s.sessionId) ?? 0) < RUNNING_EVERY_MS) return false
      return true
    })
    .slice(0, MAX_SKETCHED)
}

/**
 * The script that reads the given chats' transcripts from the given byte offsets: per chat, the task-list calls and the
 * last `cost-state` line of the piece, and where the piece ended. No double quote appears in it, so that no argument
 * quoting can change it.
 */
export function sketchScript(items: { id: string; offset: number }[]): string {
  for (const it of items) {
    if (!/^[A-Za-z0-9_-]+$/.test(it.id) || !Number.isInteger(it.offset) || it.offset < 0) throw new Error('not a session id')
  }
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    '$q = [char]34',
    `$items = '${items.map(it => `${it.id}:${it.offset}`).join(';')}'`,
    `$max = ${CHUNK_BYTES}`,
    "$p1 = $q + 'name' + $q + ':' + $q + 'mcp__ccd_turn__update_plan' + $q",
    "$p2 = $q + 'name' + $q + ':' + $q + 'mcp__ccd_turn__wrap_up' + $q",
    "$p3 = '{' + $q + 'type' + $q + ':' + $q + 'cost-state' + $q",
    // the chat's own replies carry the size of what the model was given to read
    "$p4 = $q + 'cache_read_input_tokens' + $q",
    "$p5 = $q + 'isSidechain' + $q + ':false'",
    "$p6 = '{' + $q + 'parentUuid' + $q",
    '$res = @{}',
    "foreach ($it in $items.Split(';')) {",
    "  $a = $it.Split(':'); $id = $a[0]; $off = [long]$a[1]",
    '  $r = @{ none = $true }',
    "  $mp = $env:LOCALAPPDATA + '\\Claude-Data\\*\\claude-code-sessions\\*\\*\\' + $id + '.json'",
    '  $m = Get-ChildItem -Path $mp -File | Select-Object -First 1',
    '  if ($m) {',
    '    $raw = [IO.File]::ReadAllText($m.FullName)',
    "    $c = [regex]::Match($raw, $q + 'cliSessionId' + $q + ':' + $q + '?([^,' + $q + '}]*)')",
    '    if ($c.Success) {',
    "      $tp = $env:USERPROFILE + '\\.claude\\projects\\*\\' + $c.Groups[1].Value + '.jsonl'",
    '      $t = Get-ChildItem -Path $tp -File | Select-Object -First 1',
    '      if ($t) {',
    '        $len = $t.Length',
    '        if ($off -gt $len) { $off = 0 }',
    '        $n = [int][Math]::Min($len - $off, $max)',
    '        $used = 0; $plan = @(); $cost = $null; $ctx = $null',
    '        if ($n -gt 0) {',
    "          $fs = [IO.File]::Open($t.FullName, 'Open', 'Read', 'ReadWrite')",
    '          $null = $fs.Seek($off, 0)',
    '          $buf = New-Object byte[] $n',
    '          $got = $fs.Read($buf, 0, $n)',
    '          $fs.Close()',
    '          $end = -1',
    '          if ($got -gt 0) { $end = [Array]::LastIndexOf($buf, [byte]10, $got - 1) }',
    // a piece with no line end is a record longer than the piece (a copy of a request): it is passed over, not waited for
    '          if ($end -ge 0) { $used = $end + 1 } elseif ($got -ge $max) { $used = $got }',
    '          if ($used -gt 0) {',
    '            $text = [Text.Encoding]::UTF8.GetString($buf, 0, $used)',
    '            foreach ($ln in $text.Split([char]10)) {',
    '              if ($ln.Length -lt 60000) {',
    '                if ($ln.Contains($p1) -or $ln.Contains($p2)) { $plan += $ln }',
    '                elseif ($ln.StartsWith($p3)) { $cost = $ln }',
    '                elseif ($ln.StartsWith($p6) -and $ln.Contains($p4) -and $ln.Contains($p5)) { $ctx = $ln }',
    '              }',
    '            }',
    '          }',
    '        }',
    '        $r = @{ from = $off; offset = ($off + $used); size = $len; plan = $plan; cost = $cost; ctx = $ctx }',
    '      }',
    '    }',
    '  }',
    '  $res[$id] = $r',
    '}',
    'ConvertTo-Json -InputObject $res -Compress -Depth 4',
  ].join('\n')
}

export type Piece = { none?: boolean; from: number; offset: number; size: number; plan: string[]; cost?: string; ctx?: string }

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** What sketchScript printed, per chat; anything unreadable is nothing. */
export function parseSketches(stdout: string): Record<string, Piece> {
  let top: unknown
  try {
    top = JSON.parse(stdout)
  } catch {
    return {}
  }
  const out: Record<string, Piece> = {}
  if (!top || typeof top !== 'object') return out
  for (const [id, v] of Object.entries(top as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    if (o.none === true) {
      out[id] = { none: true, from: 0, offset: 0, size: 0, plan: [] }
      continue
    }
    const offset = num(o.offset)
    const size = num(o.size)
    if (offset === undefined || size === undefined) continue
    const plan = typeof o.plan === 'string' ? [o.plan] : Array.isArray(o.plan) ? o.plan.filter((x): x is string => typeof x === 'string') : []
    out[id] = { from: num(o.from) ?? 0, offset, size, plan, ...(typeof o.cost === 'string' ? { cost: o.cost } : {}), ...(typeof o.ctx === 'string' ? { ctx: o.ctx } : {}) }
  }
  return out
}

/** Tokens written and read from the cache, added up over the models of a `cost-state` line. */
function tokensOf(line: string): { out: number; cache: number } | undefined {
  try {
    const c = JSON.parse(line) as { modelUsage?: Record<string, Record<string, unknown>> }
    let out = 0
    let cache = 0
    for (const u of Object.values(c.modelUsage ?? {})) {
      out += num(u.outputTokens) ?? 0
      cache += num(u.cacheReadInputTokens) ?? 0
    }
    return { out, cache }
  } catch {
    return undefined
  }
}

/** What the model was given to read by a reply: its input, and what came from and went to the cache. Nothing for a reply that read nothing. */
function contextOf(line: string): number | undefined {
  try {
    const u = (JSON.parse(line) as { message?: { usage?: Record<string, unknown> } }).message?.usage
    if (!u) return undefined
    const sum = (num(u.input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0)
    return sum > 0 ? sum : undefined
  } catch {
    return undefined
  }
}

/**
 * The cache after a read: each chat read is carried on from what it held (or from nothing, when its transcript was
 * rewritten and read again from the start), chats no longer listed are dropped. A run that read nothing at all for a
 * chat leaves it as it was, marked read at this activity, so a broken shell is not started at every poll.
 */
export function nextSketches(cache: SketchCache, raw: RawSession[], checked: RawSession[], found: Record<string, Piece>): SketchCache {
  const live = new Set(raw.map(s => s.sessionId))
  const out: SketchCache = {}
  for (const [id, c] of Object.entries(cache)) if (live.has(id)) out[id] = c
  for (const s of checked) {
    const prev = out[s.sessionId]
    const piece = found[s.sessionId]
    if (!piece) {
      out[s.sessionId] = prev
        ? { ...prev, at: s.lastActivityAt, size: prev.offset }
        : { at: s.lastActivityAt, offset: 0, size: 0, none: true }
      continue
    }
    if (piece.none) {
      out[s.sessionId] = { at: s.lastActivityAt, offset: 0, size: 0, none: true }
      continue
    }
    // read again from the start: what was held belongs to a transcript that is gone
    const held: Sketch | undefined = piece.from === 0 ? undefined : prev
    const start: PlanItem[] | undefined = held?.plan
    const plan = planFrom(piece.plan, start)
    const tokens = piece.cost ? tokensOf(piece.cost) : undefined
    const outTokens = tokens?.out ?? held?.out
    const cacheTokens = tokens?.cache ?? held?.cache
    const contextTokens = (piece.ctx ? contextOf(piece.ctx) : undefined) ?? held?.context
    out[s.sessionId] = {
      at: s.lastActivityAt,
      offset: piece.offset,
      size: piece.size,
      ...(plan ? { plan } : {}),
      ...(outTokens !== undefined ? { out: outTokens } : {}),
      ...(cacheTokens !== undefined ? { cache: cacheTokens } : {}),
      ...(contextTokens !== undefined ? { context: contextTokens } : {}),
    }
  }
  return out
}

/** The chats with what was read of each laid on them: the statuses of the plan, the steps of the tokens. */
export function withSketches(raw: RawSession[], cache: SketchCache): RawSession[] {
  return raw.map(s => {
    const c = cache[s.sessionId]
    if (!c) return s
    return {
      ...s,
      ...(c.plan?.length ? { plan: c.plan.map(p => p.status) } : {}),
      ...(c.context !== undefined || c.out !== undefined || c.cache !== undefined
        ? { weight: { size: c.context !== undefined ? contextStep(c.context) : sizeStep(c.out ?? 0), haze: hazeStep(c.cache ?? 0) } }
        : {}),
    }
  })
}

/** What the drawing takes from a cache: when this is the same, nothing on screen has changed. */
export const sketchLook = (cache: SketchCache): string =>
  JSON.stringify(
    Object.entries(cache)
      .map(([id, c]) => [id, c.plan?.map(p => p.status[0]).join(''), c.context !== undefined ? contextStep(c.context) : sizeStep(c.out ?? 0), hazeStep(c.cache ?? 0)])
      .sort(),
  )
