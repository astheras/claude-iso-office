import type { ErrorCache, PeerAsk, RawSession, SessionError, WaitItem } from '../types'
import { HOME_MS } from './data'

/** How many chats one run looks at, and how much of the end of each transcript it reads (the last record is all it needs). */
export const MAX_CHECKED = 30
const TAIL_BYTES = 262144

/**
 * The chats whose transcripts are to be read for an error: stopped, not archived, active within the last three days (the rest are not
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
  asks: Record<string, PeerAsk> = {},
): ErrorCache {
  const live = new Set(raw.map(s => s.sessionId))
  const out: ErrorCache = {}
  for (const [id, entry] of Object.entries(cache)) if (live.has(id)) out[id] = entry
  for (const s of checked) {
    out[s.sessionId] = {
      at: s.lastActivityAt,
      ...(found[s.sessionId] ? { error: found[s.sessionId] } : {}),
      ...(asks[s.sessionId] ? { peer: asks[s.sessionId] } : {}),
    }
  }
  return out
}

/** The requests to colleague chats the script found, as far as they are questions; anything unreadable is none. */
export function parsePeers(stdout: string): Record<string, PeerAsk> {
  const out: Record<string, PeerAsk> = {}
  let top: unknown
  try {
    top = JSON.parse(stdout)
  } catch {
    return out
  }
  if (!top || typeof top !== 'object') return out
  for (const [id, v] of Object.entries(top as Record<string, Record<string, unknown>>)) {
    if (!v || typeof v !== 'object' || typeof v.peerText !== 'string') continue
    const text = unescape(v.peerText)
    if (!isAsk(text)) continue
    const at = typeof v.peerAt === 'string' ? Date.parse(v.peerAt) : NaN
    out[id] = {
      to: typeof v.peerTo === 'string' ? v.peerTo : '',
      id: typeof v.peerId === 'string' ? v.peerId : '',
      text: text.slice(0, 300),
      at: Number.isFinite(at) ? at : 0,
    }
  }
  return out
}

/** The error to show for a chat: only while its last activity is the one the error was read at. */
export const errorOf = (cache: ErrorCache, s: RawSession): SessionError | undefined => {
  const e = cache[s.sessionId]
  return e && e.at === s.lastActivityAt ? e.error : undefined
}

/** The request a chat is waiting on, only while the chat is at the activity it was read at. */
export const peerOf = (cache: ErrorCache, s: RawSession): PeerAsk | undefined => {
  const e = cache[s.sessionId]
  return e && e.at === s.lastActivityAt ? e.peer : undefined
}

/**
 * The chat a request went to, and what it is about, as a wait: matched to a listed chat by id or by title. A request
 * about the Unity editor says so ("Unity"); one about anything else is just a wait for that chat.
 */
export function waitOf(ask: PeerAsk, listed: RawSession[]): WaitItem | undefined {
  const hit = listed.find(x => (ask.id && x.sessionId === ask.id) || (ask.to && x.title === ask.to))
  const title = hit?.title || ask.to || ask.id
  if (!title) return undefined
  return { id: hit?.sessionId ?? (ask.id || ask.to), title, ...(EDITOR.test(ask.text) ? { on: 'Unity' } : {}) }
}

// How the chats of the Unity project talk: one asks "is the editor free?", the other answers «вільно», and a chat that
// takes the editor says so and tells the other not to start. Only a question is a wait: a release («вільно») or a claim
// ("беру Editor") is the opposite.
const EDITOR = /unity|юніті|editor|редактор/i
// a release says so at the very start («вільно. Editor не в Play»); a question mentions «вільно» only later
const RELEASE = /^s*(вільно|(the )?(unity )?editor (is )?(free|idle))|free again|i'?m done with|звільнив|released/i
const CLAIM = /беру\s+(editor|редактор|unity)|i'?m taking|i am taking|taking it for|claim the editor/i
const ASK = /питання|потрібн|\bneed\b|\?|скаж|tell me|if you|чи вільн|are you done|коли звільн|напиши/i

/** True when a message to a colleague is a question that waits for an answer. */
export const isAsk = (text: string): boolean => !RELEASE.test(text.slice(0, 80)) && !CLAIM.test(text) && ASK.test(text)

/**
 * The script that reads the end of each given chat's transcript and prints the chats whose last reply was an API error.
 * It finds a chat's transcript through the app's record of it, reads only the last 256 KB, and takes the last reply of
 * the main conversation: an error if it is flagged `isApiErrorMessage`. It also takes the chat's last message to a
 * colleague chat (SendMessage) when nothing that looks like an answer («вільно», "is free") has come in since. No double quote appears in it, so that no
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
    "$sendA = $q + 'name' + $q + ':' + $q + 'SendMessage' + $q",
    "$sendB = $q + 'name' + $q + ':' + $q + 'mcp__ccd_session_mgmt__send_message' + $q",
    "$userPat = $q + 'type' + $q + ':' + $q + 'user' + $q",
    "$attPat = $q + 'type' + $q + ':' + $q + 'attachment' + $q",
    "$quePat = $q + 'type' + $q + ':' + $q + 'queue-operation' + $q",
    "$toolPat = 'tool_use_id'",
    "$resPat = 'toolUseResult'",
    "$relRx = [regex]::new('\\u0432\\u0456\\u043b\\u044c\\u043d\\u043e|is free|\\u0437\\u0432\\u0456\\u043b\\u044c\\u043d', 'IgnoreCase')",
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
    '  $r = @{}',
    '  for ($i = $lines.Length - 1; $i -ge $floor; $i--) {',
    '    $l = $lines[$i]',
    '    if ($l.Contains($typePat) -and -not $l.Contains($sidePat)) {',
    '      if ($l.Contains($errPat)) {',
    "        $r.code = Field $l ($q + 'error' + $q + ':' + $q + '([^' + $q + ']*)'); $r.status = Field $l ($q + 'apiErrorStatus' + $q + ':([0-9]+)'); $r.at = Field $l ($q + 'timestamp' + $q + ':' + $q + '([^' + $q + ']+)'); $r.text = Field $l ($q + 'text' + $q + ':' + $q + '((?:[^' + $q + '\\\\]|\\\\.)*)')",
    '      }',
    '      break',
    '    }',
    '  }',
    '  $sent = -1',
    '  for ($i = $lines.Length - 1; $i -ge $floor; $i--) {',
    '    $l = $lines[$i]',
    '    if ($l.Contains($typePat) -and ($l.Contains($sendA) -or $l.Contains($sendB))) { $sent = $i; break }',
    '  }',
    '  if ($sent -ge 0) {',
    '    $answered = $false',
    '    for ($j = $sent + 1; $j -lt $lines.Length; $j++) {',
    '      $o = $lines[$j]',
    '      if ($o.Contains($typePat) -or $o.Contains($toolPat) -or $o.Contains($resPat)) { continue }',
    '      if (-not ($o.Contains($userPat) -or $o.Contains($attPat) -or $o.Contains($quePat))) { continue }',
    '      if ($relRx.IsMatch($o)) { $answered = $true; break }',
    '    }',
    '    if (-not $answered) {',
    '      $sl = $lines[$sent]',
    "      $r.peerTo = Field $sl ($q + 'to' + $q + ':' + $q + '([^' + $q + ']*)'); $r.peerId = Field $sl ($q + 'session_id' + $q + ':' + $q + '([^' + $q + ']*)'); $r.peerAt = Field $sl ($q + 'timestamp' + $q + ':' + $q + '([^' + $q + ']+)'); $r.peerText = Field $sl ($q + 'message' + $q + ':' + $q + '((?:[^' + $q + '\\\\]|\\\\.)*)')",
    '    }',
    '  }',
    '  if ($r.Count -gt 0) { $res[$id] = $r }',
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
    // an entry that only carries a request to a colleague is not an error
    if (typeof v.code !== 'string' && typeof v.text !== 'string' && typeof v.at !== 'string') continue
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
