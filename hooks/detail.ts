import type { BgTask, Decision, Detail, McpWait, Room, Worker } from '../types'
import { agoText, WORD } from './data'
import { errorLabel } from './errors'
import { CLAUDE_DIR_PS, transcriptGlobPs } from './paths'
import { PLAN_MARK, planCount, planFrom } from './plan'

/** How long, to the minute; seconds only when short. */
export const lasting = (ms: number): string => {
  const s = Math.floor(Math.max(0, ms) / 1000)
  if (s < 60) return s < 1 ? 'менше секунди' : `${s} с`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} хв`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h} год ${m % 60} хв` : `${h} год`
  return h % 24 ? `${Math.floor(h / 24)} д ${h % 24} год` : `${Math.floor(h / 24)} д`
}

/** 224205 -> 224k, 1500000 -> 1.5M. */
export const compact = (n: number): string => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '')}k`
  return String(Math.round(n))
}

export const dollars = (usd: number): string => (usd > 0 && usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`)

const two = (n: number) => String(n).padStart(2, '0')

/** 12.11 14:03 in the machine's own time. */
export const stamp = (ms: number): string => {
  const d = new Date(ms)
  return `${two(d.getDate())}.${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** When the chat's present state began: asking since the registry says, else since its last turn edge, else since seen. */
export function stateSince(w: Worker, d: Detail | undefined): number {
  if (w.error && w.error.at) return w.error.at
  if (w.needsAnswer && w.askedAt) return w.askedAt
  return d?.turnEdgeAt || w.changedAt
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v)
  return Number.isFinite(n) ? n : undefined
}
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/**
 * The script the plugin runs to read what the app keeps on disk about one chat: its own record (the model, the turn
 * count, the id of its transcript) and the last `cost-state` line of the transcript, which a plain read could not take
 * from a file of many megabytes. No double quote appears in it, so that no argument quoting can change it.
 */
export function detailScript(sessionId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error('not a session id')
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `$id = '${sessionId}'`,
    '$q = [char]34',
    '$res = @{ meta = $null; cost = $null; plan = $null }',
    CLAUDE_DIR_PS,
    "$mp = $env:LOCALAPPDATA + '\\Claude-Data\\*\\claude-code-sessions\\*\\*\\' + $id + '.json'",
    '$m = Get-ChildItem -Path $mp -File | Select-Object -First 1',
    'if ($m) {',
    '  $raw = [IO.File]::ReadAllText($m.FullName)',
    "  function Pick($name) { $r = [regex]::Match($raw, $q + $name + $q + ':' + $q + '?([^,' + $q + '}]*)'); if ($r.Success) { $r.Groups[1].Value } }",
    "  $res.meta = @{ cliSessionId = (Pick 'cliSessionId'); model = (Pick 'model'); effort = (Pick 'effort'); permissionMode = (Pick 'permissionMode'); createdAt = (Pick 'createdAt'); lastTurnEdgeAt = (Pick 'lastTurnEdgeAt'); completedTurns = (Pick 'completedTurns') }",
    `  $tp = ${transcriptGlobPs('$res.meta.cliSessionId')}`,
    '  $t = Get-ChildItem -Path $tp -File | Select-Object -First 1',
    '  if ($t) {',
    "    $pat = '{' + $q + 'type' + $q + ':' + $q + 'cost-state' + $q",
    '    $l = Select-String -LiteralPath $t.FullName -Pattern $pat -SimpleMatch | Select-Object -Last 1',
    '    if ($l) { $res.cost = $l.Line }',
    // the task-list calls: the chat's own messages are short lines; the long ones are copies of what went to the model
    "    $pp = @(($q + 'name' + $q + ':' + $q + 'mcp__ccd_turn__update_plan' + $q), ($q + 'name' + $q + ':' + $q + 'mcp__ccd_turn__wrap_up' + $q))",
    '    $res.plan = @(Select-String -LiteralPath $t.FullName -Pattern $pp -SimpleMatch | Where-Object { $_.Line.Length -lt 60000 } | Select-Object -Last 150 | ForEach-Object { $_.Line })',
    '  }',
    '}',
    'ConvertTo-Json -InputObject $res -Compress',
  ].join('\n')
}

/** What detailScript printed, as far as it is readable; anything else is an empty answer, never an error. */
export function parseDetail(stdout: string): Detail {
  const out: Detail = {}
  let top: { meta?: Record<string, unknown> | null; cost?: unknown; plan?: unknown }
  try {
    top = JSON.parse(stdout)
  } catch {
    return out
  }
  const m = top.meta
  if (m) {
    const model = str(m.model)
    const effort = str(m.effort)
    const mode = str(m.permissionMode)
    if (model) out.model = model
    if (effort) out.effort = effort
    if (mode) out.permissionMode = mode
    const created = num(m.createdAt)
    if (created) out.createdAt = created
    const edge = num(m.lastTurnEdgeAt)
    if (edge) out.turnEdgeAt = edge
    const turns = num(m.completedTurns)
    if (turns !== undefined) out.turns = turns
  }
  if (typeof top.cost === 'string') {
    try {
      const c = JSON.parse(top.cost) as Record<string, unknown>
      const cost = num(c.totalCostUSD)
      if (cost !== undefined) out.costUSD = cost
      if (c.hasUnknownModelCost === true) out.costPartial = true
      const t = { input: 0, output: 0, thinking: 0, cacheRead: 0, cacheWrite: 0 }
      for (const u of Object.values((c.modelUsage ?? {}) as Record<string, Record<string, unknown>>)) {
        t.input += num(u.inputTokens) ?? 0
        t.output += num(u.outputTokens) ?? 0
        t.thinking += num(u.thinkingTokens) ?? 0
        t.cacheRead += num(u.cacheReadInputTokens) ?? 0
        t.cacheWrite += num(u.cacheCreationInputTokens) ?? 0
      }
      if (t.input + t.output + t.cacheRead + t.cacheWrite > 0) out.tokens = t
      const api = num(c.totalAPIDuration)
      if (api !== undefined) out.apiMs = api
      const tool = num(c.totalToolDuration)
      if (tool !== undefined) out.toolMs = tool
      const wall = num(c.totalDuration)
      if (wall !== undefined) out.wallMs = wall
      const added = num(c.totalLinesAdded)
      if (added !== undefined) out.linesAdded = added
      const removed = num(c.totalLinesRemoved)
      if (removed !== undefined) out.linesRemoved = removed
    } catch {
      // a cut or odd line: no cost, nothing else lost
    }
  }
  // one line comes back as a bare string, more as a list
  const lines = typeof top.plan === 'string' ? [top.plan] : Array.isArray(top.plan) ? top.plan.filter(x => typeof x === 'string') : []
  const plan = planFrom(lines)
  if (plan) out.plan = plan
  return out
}

/** The label and value of each line of the accordion, in order; what is not known is left out. */
export type Row = [label: string, value: string, tone?: 'bad']

export function detailRows(w: Worker, room: Room, d: Detail | undefined, now: number): Row[] {
  const rows: Row[] = []
  const add = (label: string, value: string | undefined, tone?: 'bad') => {
    if (value) rows.push(tone ? [label, value, tone] : [label, value])
  }
  add('Стан', `${stateWord(w)} · ${lasting(now - stateSince(w, d))}`, w.error ? 'bad' : undefined)
  if (w.decision && !w.error) add('Рішення', `${decisionText(w.decision)}${w.decision.at ? ` · ${lasting(now - w.decision.at)}` : ''}`)
  if (w.waitsFor?.length) add('Чекає', w.waitsFor.map(waitText).join('; '))
  // a call to an MCP tool that has not answered: which server and which tool, and for how long (a question to the person is not this)
  if (w.mcp && !w.needsAnswer) add('Чекає MCP', `${mcpName(w.mcp)}${w.mcp.at ? ` · ${lasting(now - w.mcp.at)}` : ''}`)
  // what it started in the background and is still going: each task, what it is, and for how long
  for (const t of w.tasks ?? []) add('Чекає задачу', `${taskText(t)}${t.at ? ` · ${lasting(now - t.at)}` : ''}`)
  if (w.error) {
    add('Помилка', errorLabel(w.error), 'bad')
    add('Повідомлення', w.error.text.length > 200 ? `${w.error.text.slice(0, 200)}…` : w.error.text, 'bad')
  }
  if (d?.plan) {
    const { done, total } = planCount(d.plan)
    add('План', `${done} з ${total}`)
    for (const p of d.plan) add(PLAN_MARK[p.status], p.text)
  }
  if (d) {
    if (d.costUSD !== undefined) add('Вартість', `${d.costPartial ? '≥ ' : ''}${dollars(d.costUSD)}`)
    if (d.tokens) {
      const t = d.tokens
      add(
        'Токени',
        `вихід ${compact(t.output)} · вхід ${compact(t.input)}${t.thinking ? ` · міркування ${compact(t.thinking)}` : ''}`,
      )
      add('Кеш', `читання ${compact(t.cacheRead)} · запис ${compact(t.cacheWrite)}`)
    }
    if (d.context) add('Контекст', `${compact(d.context.used)} з ${compact(d.context.window)} · ${d.context.percent}%`)
    add('Модель', [d.model, d.effort].filter(Boolean).join(' · '))
    add('Дозволи', d.permissionMode)
    if (d.turns !== undefined) add('Ходів', String(d.turns))
    if (d.createdAt) add('Створено', `${stamp(d.createdAt)} (${agoText(d.createdAt, now)})`)
    if (d.wallMs !== undefined) {
      const parts = [`загалом ${lasting(d.wallMs)}`]
      if (d.apiMs !== undefined) parts.push(`модель ${lasting(d.apiMs)}`)
      if (d.toolMs !== undefined) parts.push(`інструменти ${lasting(d.toolMs)}`)
      add('Тривалість', parts.join(' · '))
    }
    if (d.linesAdded !== undefined || d.linesRemoved !== undefined) {
      add('Код', `+${d.linesAdded ?? 0} −${d.linesRemoved ?? 0}`)
    }
    add('Гілка', d.branch)
  }
  const pr = d?.prNumber ?? w.prNumber
  if (pr) add('PR', `#${pr}${d?.prState ? ` · ${d.prState}` : ''}`)
  add('Проєкт', room.name)
  add('Папка', d?.cwd)
  return rows
}

/** The word for the group a chat is listed in, for the "state" line. */
export const stateWord = (w: Worker): string =>
  w.error
    ? 'помилка'
    : w.needsAnswer
      ? w.decision
        ? 'чекає рішення'
        : 'чекає відповіді'
      : w.waitsFor
        ? 'чекає іншого агента'
        : w.tasks?.length
          ? 'чекає фонову задачу'
          : WORD[w.kind]

/** What the agent has put to the person: «питання з варіантами» or «план на схвалення». */
export const decisionText = (x: Decision): string => (x.kind === 'plan' ? 'план на схвалення' : 'питання з варіантами')

/** One thing a chat waits for: «Unity (Їжа для комплексів)», or just the chat's title. */
export const waitText = (x: { title: string; on?: string }): string => (x.on ? `${x.on} (${x.title})` : x.title)

/** The tool a running chat is held up by, as a name: «Claude_Browser · browser_batch». */
export const mcpName = (m: McpWait): string => `${m.server} · ${m.tool}`

/** One task a chat started in the background: its description, and what kind it is («монітор», «фонова команда», «MCP»). */
export const taskText = (t: BgTask): string => `${t.what} (${[t.kind === 'monitor' ? 'монітор' : 'фонова команда', t.mcp ? 'MCP' : ''].filter(Boolean).join(', ')})`

/** What a stopped chat waits for in the background, in a line: the first task, and how many more. */
export const tasksText = (w: Worker): string | undefined => {
  if (!w.tasks?.length) return undefined
  const [first, ...more] = w.tasks
  return `${first!.what}${first!.mcp ? ' (MCP)' : ''}${more.length ? ` і ще ${more.length}` : ''}`
}

/** What a chat waits for, in a line: the first one, and how many more. */
export const waitsText = (w: Worker): string | undefined => {
  if (!w.waitsFor?.length) return undefined
  const [first, ...more] = w.waitsFor
  return `${waitText(first!)}${more.length ? ` і ще ${more.length}` : ''}`
}
