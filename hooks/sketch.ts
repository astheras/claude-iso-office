import type { Decision, McpWait, PlanItem, RawSession, Sketch, SketchCache, TurnAsk } from '../types'
import { HOME_MS } from './data'
import { CLAUDE_DIR_PS, transcriptGlobPs } from './paths'
import { planFrom } from './plan'
import { tasksFrom } from './tasks'

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
/** What the reader knows: a cache made by an older one is read once more, for it lacks what has been added since. */
export const SKETCH_VERSION = 4

/** Where the next read of a chat starts: after what was read, but from the start when an older reader made the cache. */
export const sketchOffset = (c: Sketch | undefined): number => (c && c.v === SKETCH_VERSION ? c.offset : 0)

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
      if (c && c.v === SKETCH_VERSION && c.at === s.lastActivityAt && c.offset >= c.size) return false
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
    // the end of the transcript, for a call to an MCP tool (or a question or a plan put to the person) that has not been
    // answered: the ids of the answers, and a call
    "$p7 = $q + 'tool_use_id' + $q + ':' + $q + '([^' + $q + ']+)'",
    "$p8 = 'tool_use_id'",
    "$p9 = $q + 'type' + $q + ':' + $q + 'assistant' + $q",
    "$p11 = $q + 'type' + $q + ':' + $q + 'tool_use' + $q",
    "$p10 = $p11 + ',' + $q + 'id' + $q + ':' + $q + '([^' + $q + ']+)' + $q + ',' + $q + 'name' + $q + ':' + $q + '(mcp__[^' + $q + ']+|AskUserQuestion|ExitPlanMode)'",
    "$p12 = $q + 'timestamp' + $q + ':' + $q + '([^' + $q + ']+)'",
    // the question the last turn ended on, and when: the chat's own file keeps both (`turnWrapUp.needsUser`), as JSON text.
    // The pattern is: "needsUser":"(any run of non-quote non-backslash characters, or a backslash and the one after it)"
    "$pn = $q + 'needsUser' + $q + ':' + $q + '((?:[^' + $q + '\\\\]|\\\\.)*)' + $q",
    "$pe = $q + 'lastTurnEdgeAt' + $q + ':([0-9]+)'",
    // when the chat's file keeps no question (a chat started from another may not), the transcript has it: the `ask` of the
    // wrap-up call the turn ended on, as JSON text; a prompt of the person after that call means the turn has gone on
    "$pu = $q + 'type' + $q + ':' + $q + 'user' + $q",
    "$pk = $q + 'ask' + $q + ':' + $q + '((?:[^' + $q + '\\\\]|\\\\.)*)' + $q",
    // work started in the background: the calls that start (or stop) it, the answers that name it, the notices that end it
    "$pb1 = $q + 'run_in_background' + $q + ':true'",
    "$pb2 = $q + 'name' + $q + ':' + $q + 'Monitor' + $q",
    "$pb3 = $q + 'name' + $q + ':' + $q + 'TaskStop' + $q",
    "$pb4 = 'running in background with ID'",
    "$pb5 = 'Monitor started (task'",
    "$pb6 = '<task-notification>'",
    "$pb7 = 'Async agent launched successfully'",
    '$res = @{}',
    CLAUDE_DIR_PS,
    "foreach ($it in $items.Split(';')) {",
    "  $a = $it.Split(':'); $id = $a[0]; $off = [long]$a[1]",
    '  $r = @{ none = $true }',
    "  $mp = $env:LOCALAPPDATA + '\\Claude-Data\\*\\claude-code-sessions\\*\\*\\' + $id + '.json'",
    '  $m = Get-ChildItem -Path $mp -File | Select-Object -First 1',
    '  if ($m) {',
    '    $raw = [IO.File]::ReadAllText($m.FullName)',
    '    $nu = [regex]::Match($raw, $pn); $ne = [regex]::Match($raw, $pe)',
    '    $ask = $null; $edge = $null',
    '    if ($nu.Success) { $ask = $nu.Groups[1].Value }',
    '    if ($ne.Success) { $edge = $ne.Groups[1].Value }',
    "    $c = [regex]::Match($raw, $q + 'cliSessionId' + $q + ':' + $q + '?([^,' + $q + '}]*)')",
    '    if ($c.Success) {',
    `      $tp = ${transcriptGlobPs('$c.Groups[1].Value')}`,
    '      $t = Get-ChildItem -Path $tp -File | Select-Object -First 1',
    '      if ($t) {',
    '        $len = $t.Length',
    '        if ($off -gt $len) { $off = 0 }',
    '        $n = [int][Math]::Min($len - $off, $max)',
    '        $used = 0; $plan = @(); $cost = $null; $ctx = $null; $bg = @()',
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
    '                if ($ln.Contains($pb6) -or $ln.Contains($pb4) -or $ln.Contains($pb5) -or $ln.Contains($pb7)) { $bg += $ln }',
    '                elseif ($ln.Contains($p11) -and ($ln.Contains($pb1) -or $ln.Contains($pb2) -or $ln.Contains($pb3))) { $bg += $ln }',
    '              }',
    '            }',
    '          }',
    '        }',
    // Once the chat is read to the end: the last 256 KB, from the end back. The answer to a call (a record with its id) is
    // seen before the call; a call of the chat's own to an MCP tool that nothing has answered is what it waits on. A text
    // reply, or more than a few calls of other tools after it, means the turn has gone on: nothing is waited for.
    '        $mcp = $null',
    '        if (($off + $used) -ge $len) {',
    '          $tn = [int][Math]::Min($len, 262144)',
    "          $f2 = [IO.File]::Open($t.FullName, 'Open', 'Read', 'ReadWrite')",
    '          $null = $f2.Seek($len - $tn, 0)',
    '          $tb = New-Object byte[] $tn',
    '          $tg = $f2.Read($tb, 0, $tn)',
    '          $f2.Close()',
    '          $tl = [Text.Encoding]::UTF8.GetString($tb, 0, $tg).Split([char]10)',
    '          $lo = 0',
    '          if ($tn -lt $len) { $lo = 1 }',
    '          $done = @{}; $ns = 0',
    '          for ($i = $tl.Length - 1; $i -ge $lo; $i--) {',
    '            $l = $tl[$i]',
    '            if ($l.Contains($p8)) {',
    // the id of an answer may come after its text (a long answer), so the whole line is searched
    '              foreach ($mm in [regex]::Matches($l, $p7)) { $done[$mm.Groups[1].Value] = $true }',
    '            } elseif ($l.Contains($p5) -and $l.Contains($p9)) {',
    '              $hit = $null; $any = $false',
    '              foreach ($mm in [regex]::Matches($l, $p10)) { $any = $true; if (-not $done.ContainsKey($mm.Groups[1].Value)) { $hit = $mm } }',
    '              if ($hit) {',
    '                $ts = [regex]::Match($l, $p12)',
    '                $mcp = @{ name = $hit.Groups[2].Value; at = $ts.Groups[1].Value }',
    '                break',
    '              }',
    '              if (-not $any -and -not $l.Contains($p11)) { break }',
    '              $ns++',
    '              if ($ns -ge 4) { break }',
    '            }',
    '          }',
    // From the end back again: the last wrap-up call, if no prompt of the person follows it (answers to calls and the
    // chat's own closing words do not count), is the question the turn ended on.
    '          if (-not $ask) {',
    '            for ($i = $tl.Length - 1; $i -ge $lo; $i--) {',
    '              $l = $tl[$i]',
    '              if (-not $l.Contains($p5)) { continue }',
    '              if ($l.Contains($p9)) {',
    '                $w = $l.IndexOf($p2)',
    '                if ($w -ge 0) {',
    '                  $wm = [regex]::Match($l.Substring($w), $pk)',
    '                  if ($wm.Success -and $wm.Groups[1].Value.Trim().Length -gt 0) {',
    '                    $ask = $wm.Groups[1].Value',
    '                    $wt = [regex]::Match($l, $p12)',
    '                    if (-not $edge -and $wt.Success) { $edge = [string][DateTimeOffset]::Parse($wt.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture).ToUnixTimeMilliseconds() }',
    '                  }',
    '                  break',
    '                }',
    '              } elseif ($l.Contains($pu) -and -not $l.Contains($p8)) { break }',
    '            }',
    '          }',
    '        }',
    '        $r = @{ from = $off; offset = ($off + $used); size = $len; plan = $plan; cost = $cost; ctx = $ctx; mcp = $mcp; bg = $bg; ask = $ask; edge = $edge }',
    '      }',
    '    }',
    '  }',
    '  $res[$id] = $r',
    '}',
    'ConvertTo-Json -InputObject $res -Compress -Depth 4',
  ].join('\n')
}

export type Piece = {
  none?: boolean
  from: number
  offset: number
  size: number
  plan: string[]
  cost?: string
  ctx?: string
  mcp?: McpWait
  decision?: Decision
  ask?: TurnAsk
  /** the lines of the piece that begin, name or end a task started in the background */
  bg?: string[]
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** The wait a call that has not returned makes: `mcp__server__tool` read as a server and a tool, and the time the call was made. */
export function mcpOf(v: unknown): McpWait | undefined {
  if (!v || typeof v !== 'object') return undefined
  const { name, at } = v as { name?: unknown; at?: unknown }
  const m = typeof name === 'string' ? /^mcp__(.+?)__(.+)$/.exec(name) : null
  if (!m) return undefined
  const ms = typeof at === 'string' ? Date.parse(at) : NaN
  return { server: m[1]!, tool: m[2]!, ...(Number.isFinite(ms) ? { at: ms } : {}) }
}

/** The decision a call that has not returned puts to the person: `AskUserQuestion` is a question, `ExitPlanMode` a plan to approve. */
export function decisionOf(v: unknown): Decision | undefined {
  if (!v || typeof v !== 'object') return undefined
  const { name, at } = v as { name?: unknown; at?: unknown }
  const kind = name === 'AskUserQuestion' ? 'question' : name === 'ExitPlanMode' ? 'plan' : undefined
  if (!kind) return undefined
  const ms = typeof at === 'string' ? Date.parse(at) : NaN
  return { kind, ...(Number.isFinite(ms) ? { at: ms } : {}) }
}

/** The question a turn ended on: the text as the file spells it (a JSON string without its quotes) and the time the turn ended. */
export function askOf(text: unknown, edge: unknown): TurnAsk | undefined {
  if (typeof text !== 'string' || text === '') return undefined
  let plain: unknown
  try {
    plain = JSON.parse(`"${text}"`)
  } catch {
    plain = text
  }
  if (typeof plain !== 'string' || plain.trim() === '') return undefined
  const at = Number(edge)
  return { text: plain.trim(), ...(Number.isFinite(at) && at > 0 ? { at } : {}) }
}

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
    const mcp = mcpOf(o.mcp)
    const decision = decisionOf(o.mcp)
    const ask = askOf(o.ask, o.edge)
    const bg = typeof o.bg === 'string' ? [o.bg] : Array.isArray(o.bg) ? o.bg.filter((x): x is string => typeof x === 'string') : []
    out[id] = {
      from: num(o.from) ?? 0,
      offset,
      size,
      plan,
      ...(typeof o.cost === 'string' ? { cost: o.cost } : {}),
      ...(typeof o.ctx === 'string' ? { ctx: o.ctx } : {}),
      ...(mcp ? { mcp } : {}),
      ...(decision ? { decision } : {}),
      ...(ask ? { ask } : {}),
      ...(bg.length ? { bg } : {}),
    }
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
        ? { ...prev, at: s.lastActivityAt, size: prev.offset, v: SKETCH_VERSION }
        : { at: s.lastActivityAt, offset: 0, size: 0, none: true, v: SKETCH_VERSION }
      continue
    }
    if (piece.none) {
      out[s.sessionId] = { at: s.lastActivityAt, offset: 0, size: 0, none: true, v: SKETCH_VERSION }
      continue
    }
    // read again from the start: what was held belongs to a transcript that is gone
    const held: Sketch | undefined = piece.from === 0 ? undefined : prev
    const start: PlanItem[] | undefined = held?.plan
    const plan = planFrom(piece.plan, start)
    // what was left open by the earlier pieces goes on, less what this piece ended, plus what it began
    const tasks = tasksFrom(piece.bg ?? [], held?.tasks)
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
      // not carried on: it is the state at the end of the transcript, read afresh each time the end is reached
      ...(piece.mcp ? { mcp: piece.mcp } : {}),
      ...(piece.decision ? { decision: piece.decision } : {}),
      ...(piece.ask ? { ask: piece.ask } : {}),
      v: SKETCH_VERSION,
      ...(tasks.length ? { tasks } : {}),
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
      ...(c.mcp ? { mcp: c.mcp } : {}),
      ...(c.decision ? { decision: c.decision } : {}),
      ...(c.ask ? { turnAsk: c.ask } : {}),
      ...(c.tasks?.length ? { tasks: c.tasks } : {}),
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
      .map(([id, c]) => [id, c.plan?.map(p => p.status[0]).join(''), c.context !== undefined ? contextStep(c.context) : sizeStep(c.out ?? 0), hazeStep(c.cache ?? 0), c.mcp ? `${c.mcp.server}/${c.mcp.tool}` : '', c.decision?.kind ?? '', c.ask ? `${c.ask.text}@${c.ask.at ?? ''}` : '', c.tasks?.map(t => t.id).join(',') ?? ''])
      .sort(),
  )
