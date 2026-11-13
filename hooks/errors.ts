import type { ErrorCache, RawSession, SessionError } from '../types'
import { HOME_MS } from './data'

/** How many chats one run looks at, and how much of the end of each transcript it reads (the last record is all it needs). */
export const MAX_CHECKED = 30
const TAIL_BYTES = 262144

/**
 * The chats whose transcripts are to be read for an error: stopped, not archived, active within the day (the rest are not
 * listed), and not read since their last activity. A transcript changes only when the chat does, so a read is made once
 * per activity, not once per poll.
 */
export function needsCheck(raw: RawSession[], cache: ErrorCache, now: number): RawSession[] {
  return raw
    .filter(
      s =>
        !s.isArchived &&
        !s.isRunning &&
        now - (Date.parse(s.lastActivityAt) || 0) < HOME_MS &&
        cache[s.sessionId]?.at !== s.lastActivityAt,
    )
    .slice(0, MAX_CHECKED)
}

/** The cache after a read: what was read replaces its entries, chats no longer listed are dropped. */
export function nextCache(
  cache: ErrorCache,
  raw: RawSession[],
  checked: RawSession[],
  found: Record<string, SessionError>,
): ErrorCache {
  const live = new Set(raw.map(s => s.sessionId))
  const out: ErrorCache = {}
  for (const [id, entry] of Object.entries(cache)) if (live.has(id)) out[id] = entry
  for (const s of checked) out[s.sessionId] = { at: s.lastActivityAt, ...(found[s.sessionId] ? { error: found[s.sessionId] } : {}) }
  return out
}

/** The error to show for a chat: only while its last activity is the one the error was read at. */
export const errorOf = (cache: ErrorCache, s: RawSession): SessionError | undefined => {
  const e = cache[s.sessionId]
  return e && e.at === s.lastActivityAt ? e.error : undefined
}

/**
 * The script that reads the end of each given chat's transcript and prints the chats whose last reply was an API error.
 * It finds a chat's transcript through the app's record of it, reads only the last 256 KB, and takes the last reply of
 * the main conversation: an error if it is flagged `isApiErrorMessage`. No double quote appears in it, so that no
 * argument quoting can change it.
 */
export function errorsScript(sessionIds: string[]): string {
  for (const id of sessionIds) if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('not a session id')
  const list = sessionIds.map(id => `'${id}'`).join(',')
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    '$q = [char]34',
    `$ids = @(${list || "''"})`,
    '$res = @{}',
    'function Field($line, $pattern) { $r = [regex]::Match($line, $pattern); if ($r.Success) { $r.Groups[1].Value } }',
    "$typePat = $q + 'type' + $q + ':' + $q + 'assistant' + $q",
    "$sidePat = $q + 'isSidechain' + $q + ':true'",
    "$errPat = $q + 'isApiErrorMessage' + $q + ':true'",
    'foreach ($id in $ids) {',
    "  $m = Get-ChildItem -Path ($env:LOCALAPPDATA + '\\Claude-Data\\*\\claude-code-sessions\\*\\*\\' + $id + '.json') -File | Select-Object -First 1",
    '  if (-not $m) { continue }',
    "  $cli = Field ([IO.File]::ReadAllText($m.FullName)) ($q + 'cliSessionId' + $q + ':' + $q + '([^' + $q + ']+)')",
    '  if (-not $cli) { continue }',
    "  $t = Get-ChildItem -Path ($env:USERPROFILE + '\\.claude\\projects\\*\\' + $cli + '.jsonl') -File | Select-Object -First 1",
    '  if (-not $t) { continue }',
    "  $fs = [IO.File]::Open($t.FullName, 'Open', 'Read', 'ReadWrite')",
    '  try {',
    `    $n = [Math]::Min($fs.Length, ${TAIL_BYTES})`,
    '    $partial = $fs.Length -gt $n',
    '    $fs.Seek(-$n, [IO.SeekOrigin]::End) | Out-Null',
    '    $buf = New-Object byte[] $n',
    '    $got = $fs.Read($buf, 0, $n)',
    '    $text = [Text.Encoding]::UTF8.GetString($buf, 0, $got)',
    '  } finally { $fs.Close() }',
    '  $lines = $text.Split([char]10)',
    '  $floor = 0',
    '  if ($partial) { $floor = 1 }',
    '  for ($i = $lines.Length - 1; $i -ge $floor; $i--) {',
    '    $l = $lines[$i]',
    '    if ($l.Contains($typePat) -and -not $l.Contains($sidePat)) {',
    '      if ($l.Contains($errPat)) {',
    "        $res[$id] = @{ code = (Field $l ($q + 'error' + $q + ':' + $q + '([^' + $q + ']*)')); status = (Field $l ($q + 'apiErrorStatus' + $q + ':([0-9]+)')); at = (Field $l ($q + 'timestamp' + $q + ':' + $q + '([^' + $q + ']+)')); text = (Field $l ($q + 'text' + $q + ':' + $q + '((?:[^' + $q + '\\\\]|\\\\.)*)')) }",
    '      }',
    '      break',
    '    }',
    '  }',
    '}',
    'ConvertTo-Json -InputObject $res -Compress',
  ].join('\n')
}

const unescape = (raw: string): string => {
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    return raw
  }
}

/** What errorsScript printed, per chat; anything unreadable is simply no error. */
export function parseErrors(stdout: string): Record<string, SessionError> {
  const out: Record<string, SessionError> = {}
  let top: unknown
  try {
    top = JSON.parse(stdout)
  } catch {
    return out
  }
  if (!top || typeof top !== 'object') return out
  for (const [id, v] of Object.entries(top as Record<string, Record<string, unknown>>)) {
    if (!v || typeof v !== 'object') continue
    const at = typeof v.at === 'string' ? Date.parse(v.at) : NaN
    const status = typeof v.status === 'string' && v.status !== '' ? Number(v.status) : NaN
    out[id] = {
      code: typeof v.code === 'string' && v.code !== '' ? v.code : 'error',
      ...(Number.isFinite(status) ? { status } : {}),
      text: typeof v.text === 'string' ? unescape(v.text) : '',
      at: Number.isFinite(at) ? at : 0,
    }
  }
  return out
}

const LABELS: Record<string, string> = {
  authentication_failed: 'помилка авторизації',
  rate_limit: 'перевищено ліміт запитів',
  server_error: 'помилка сервера',
  billing_error: 'проблема з оплатою',
  invalid_request: 'некоректний запит',
  overloaded: 'сервіс перевантажено',
}

/** A short word for what went wrong, with the HTTP status when there was one: «помилка авторизації (403)». */
export const errorLabel = (e: SessionError): string => `${LABELS[e.code] ?? 'помилка'}${e.status ? ` (${e.status})` : ''}`
