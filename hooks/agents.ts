import type { Subagent } from '../types'
import { ago, agoText } from './data'

/** How many helpers the accordion names one by one; the rest are counted. */
export const MAX_AGENTS = 8

/** A helper whose record says it is not over, but whose transcript has not been written to for this long, is called quiet. */
export const QUIET_MS = 10 * 60 * 1000

/** The most helpers read for one chat: the newest by the time their record was written. */
const READ_MAX = 30

/** A line of a transcript that is longer than this is not read for the model or the call: it holds a copy of a file, not a step. */
const LINE_MAX = 6000

/**
 * The PowerShell that reads the helpers of a chat, to go inside the part of `detailScript` that has the chat's transcript
 * in `$t` (and `$res`, `$q` set). The helpers of a chat lie beside its transcript: `<project>\<chat>\subagents\agent-*`.
 *
 * - `agent-*.meta.json` is small and is taken whole: the kind of agent, its task, the model asked for, `finished` once it is over.
 * - `agent-*.jsonl` can be many megabytes, with single lines of 100k (copies of files): only its last 40 lines are read, and of
 *   those only the short ones. The last short line of the assistant gives the model it ran on; the last short call, the call it
 *   is in the middle of (not read for one that is over).
 * - `agent-*.prefix.json` appears when a helper ends: the model, for one whose tail says none.
 *
 * No double quote appears in it, so that no argument quoting can change it.
 */
export function agentsScriptLines(): string[] {
  return [
    "    $sd = $t.DirectoryName + '\\' + $res.meta.cliSessionId + '\\subagents'",
    "    $ap = $q + 'type' + $q + ':' + $q + 'assistant' + $q",
    "    $tu = $q + 'type' + $q + ':' + $q + 'tool_use' + $q",
    "    $fin = $q + 'finished' + $q + ':true'",
    "    $mm = $q + 'model' + $q + ':' + $q + '([^' + $q + ']*)'",
    `    $res.agents = @(Get-ChildItem -LiteralPath $sd -Filter 'agent-*.meta.json' -File | Sort-Object LastWriteTime -Descending | Select-Object -First ${READ_MAX} | ForEach-Object {`,
    '      $base = $_.FullName.Substring(0, $_.FullName.Length - 10)',
    '      $a = @{ meta = [IO.File]::ReadAllText($_.FullName); at = $null; model = $null; tool = $null }',
    '      $isOver = $a.meta.Contains($fin)',
    "      $jf = Get-Item -LiteralPath ($base + '.jsonl')",
    '      if ($jf) {',
    '        $a.at = ([DateTimeOffset]$jf.LastWriteTimeUtc).ToUnixTimeMilliseconds()',
    `        $tail = @(Get-Content -LiteralPath $jf.FullName -Tail 40 | Where-Object { $_.Length -lt ${LINE_MAX} -and $_.Contains($ap) })`,
    '        if ($tail.Count -gt 0) { $r = [regex]::Match($tail[$tail.Count - 1], $mm); if ($r.Success) { $a.model = $r.Groups[1].Value } }',
    '        $tl = @($tail | Where-Object { $_.Contains($tu) })',
    '        if (-not $isOver -and $tl.Count -gt 0) { $a.tool = $tl[$tl.Count - 1] }',
    '      }',
    "      if (-not $a.model -and (Test-Path -LiteralPath ($base + '.prefix.json'))) { $r = [regex]::Match([IO.File]::ReadAllText($base + '.prefix.json'), $mm); if ($r.Success) { $a.model = $r.Groups[1].Value } }",
    '      $a',
    '    })',
  ]
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

const objectOf = (text: unknown): Record<string, unknown> | undefined => {
  if (typeof text !== 'string') return undefined
  try {
    const v: unknown = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** One line of text, cut to `max` characters. */
const cut = (text: string, max: number): string => {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

/** A call as one short line: «Read galaxy.ts», «Grep isSidechain», «Bash npm test». */
export function callText(name: string, input: Record<string, unknown>): string {
  // the helper's last word: its report goes to the chat that started it
  if (name === 'SubagentHandback') return 'здає звіт'
  const pick = (...keys: string[]): string | undefined => keys.map(k => str(input[k])).find(Boolean)
  let arg: string | undefined
  if (['Read', 'Edit', 'Write', 'NotebookEdit'].includes(name)) {
    const p = pick('file_path', 'notebook_path')
    arg = p && baseName(p)
  } else if (['Grep', 'Glob'].includes(name)) arg = pick('pattern')
  else if (['Bash', 'PowerShell'].includes(name)) arg = pick('command')
  else if (name === 'WebFetch') arg = pick('url')
  else if (name === 'WebSearch') arg = pick('query')
  else if (name === 'Agent') arg = pick('description')
  return arg ? `${name} ${cut(arg, 60)}` : name
}

/** The last call in a transcript line of the assistant, as one short line; nothing when the line holds none. */
export function lastCall(line: unknown): string | undefined {
  const rec = objectOf(line)
  const content = (rec?.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return undefined
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i] as { type?: unknown; name?: unknown; input?: unknown } | undefined
    if (b?.type === 'tool_use' && typeof b.name === 'string') {
      const input = b.input && typeof b.input === 'object' ? (b.input as Record<string, unknown>) : {}
      return callText(b.name, input)
    }
  }
  return undefined
}

/**
 * What the script printed for the helpers: one entry per helper, `{ meta, at, model, tool }`, as a list (a lone one may come as
 * a bare object). A helper whose record cannot be read is left out; none readable is nothing, never an error.
 */
export function parseAgents(raw: unknown): Subagent[] | undefined {
  const list: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []
  const out: Subagent[] = []
  for (const x of list) {
    if (!x || typeof x !== 'object') continue
    const e = x as Record<string, unknown>
    const meta = objectOf(e.meta)
    if (!meta) continue
    const done = meta.finished === true
    const type = str(meta.agentType) ?? 'агент'
    const what = str(meta.description)
    const asked = str(meta.model)
    const model = str(e.model)
    const at = num(e.at)
    const depth = num(meta.spawnDepth)
    // only one that is not over is in the middle of a call
    const doing = !done ? lastCall(e.tool) : undefined
    out.push({
      id: str(meta.toolUseId) ?? `${type}-${out.length}`,
      type,
      ...(what ? { what } : {}),
      ...(model ? { model } : {}),
      ...(asked ? { asked } : {}),
      done,
      ...(at !== undefined ? { at } : {}),
      ...(doing ? { doing } : {}),
      ...(depth !== undefined ? { depth } : {}),
    })
  }
  return out.length ? out : undefined
}

export type AgentState = 'run' | 'done' | 'quiet'

/** Running, over, or not over but quiet: a record with no `finished` and no writes for a while may be a helper that was cut off. */
export const agentState = (a: Subagent, now: number): AgentState =>
  a.done ? 'done' : a.at !== undefined && now - a.at > QUIET_MS ? 'quiet' : 'run'

/** Some helper of the chat is at work this moment: the accordion is then read again more often. */
export const hasLiveAgent = (agents: Subagent[] | undefined, now: number): boolean => !!agents?.some(a => agentState(a, now) === 'run')

export const AGENT_MARK: Record<AgentState, string> = { run: '▶', done: '✓', quiet: '…' }

const ORDER: Record<AgentState, number> = { run: 0, quiet: 1, done: 2 }

/** The model of a helper: the one it ran on; else the one asked for, said to be only that; else nothing known. */
export const modelText = (a: Subagent): string => a.model ?? (a.asked ? `${a.asked} (запит)` : 'модель невідома')

/** One helper in a line: its kind, its model, its task, and when it ended or how long it has been quiet. */
export function agentLine(a: Subagent, state: AgentState, now: number): string {
  const parts = [a.type, modelText(a), a.what ? cut(a.what, 70) : '']
  if (state === 'done' && a.at !== undefined) parts.push(agoText(a.at, now))
  if (state === 'quiet' && a.at !== undefined) parts.push(`без руху ${ago(a.at, now)}`)
  return `${a.depth && a.depth > 1 ? '↳ ' : ''}${parts.filter(Boolean).join(' · ')}`
}

/**
 * The rows the accordion shows for the helpers of a chat: a count line, then each helper (the ones at work first, then the
 * quiet, then the ones that are over, newest first) with, under one at work, the call it is in; the rest only counted.
 */
export function agentRows(agents: Subagent[], now: number): [label: string, value: string][] {
  if (!agents.length) return []
  const all = agents
    .map(a => ({ a, s: agentState(a, now) }))
    .sort((x, y) => ORDER[x.s] - ORDER[y.s] || (y.a.at ?? 0) - (x.a.at ?? 0))
  const n = (s: AgentState) => all.filter(x => x.s === s).length
  const head = [n('run') ? `${n('run')} працює` : '', n('quiet') ? `${n('quiet')} без руху` : '', n('done') ? `${n('done')} завершено` : '']
  const rows: [string, string][] = [['Субагенти', head.filter(Boolean).join(' · ')]]
  for (const { a, s } of all.slice(0, MAX_AGENTS)) {
    rows.push([AGENT_MARK[s], agentLine(a, s, now)])
    if (s === 'run' && a.doing) rows.push(['', `зараз: ${a.doing}`])
  }
  if (all.length > MAX_AGENTS) rows.push(['', `і ще ${all.length - MAX_AGENTS}`])
  return rows
}
