/** One session as the app's list_sessions returns it (the fields the office reads). */
export type RawSession = {
  sessionId: string
  title: string
  cwd?: string
  isArchived?: boolean
  isRunning: boolean
  lastActivityAt: string
  prNumber?: number
  prState?: string
  startedBy?: string
  link?: string
  /** the session is blocked on the person (a permission or a question); not in list_sessions, read from the registry */
  needsAnswer?: boolean
  /** when the chat started to wait for the person (ms), from the registry */
  askedAt?: number
}

/** work: running now. wait: finished lately and not yet looked at. rest: idle. home: idle over a day. */
export type Kind = 'work' | 'wait' | 'rest' | 'home'

export type Worker = {
  id: string
  title: string
  link: string
  kind: Kind
  activityAt: number
  /** when `kind` last changed (ms); with `prevKind` it lets the floor play the walk */
  changedAt: number
  /** the kind before the last change, absent if first seen or unchanged since the mod started */
  prevKind?: Kind
  prNumber?: number
  /** blocked on the person: listed first, whatever its kind */
  needsAnswer?: boolean
  askedAt?: number
  /** a session started from another one that is in the list: drawn as an intern */
  parentId?: string
}

export type Room = {
  key: string
  name: string
  type: 'project' | 'remote' | 'cowork'
  /** workers sitting at desks: every kind except home, busiest first */
  workers: Worker[]
  /** sessions idle over a day: not drawn, counted on the door */
  homeCount: number
  /** open pull requests of the room's sessions */
  prNumbers: number[]
}

/** What the mod remembers between polls, to see who just finished. */
export type Memory = {
  /** false until the first poll has been read: no events from that one */
  ready: boolean
  muted: boolean
  sessions: Record<
    string,
    { running: boolean; finishedAt?: number; isAcked?: boolean; kind?: Kind; since?: number; prevKind?: Kind }
  >
}

/** What the accordion of a chosen chat shows; every field is optional, a missing one is left out of the rows. */
export type Detail = {
  model?: string
  effort?: string
  permissionMode?: string
  branch?: string
  cwd?: string
  prState?: string
  prNumber?: number
  /** ms since the epoch */
  createdAt?: number
  /** the last turn started or ended: for a running chat, when its turn began */
  turnEdgeAt?: number
  turns?: number
  /** spent so far, in US dollars, as of the last finished turn */
  costUSD?: number
  /** a model in the chat has no price on record: the cost is at least this */
  costPartial?: boolean
  tokens?: { input: number; output: number; thinking: number; cacheRead: number; cacheWrite: number }
  apiMs?: number
  toolMs?: number
  wallMs?: number
  linesAdded?: number
  linesRemoved?: number
  /** how full the context window is (only for a chat whose process is up) */
  context?: { used: number; window: number; percent: number }
}

/** The chosen chat's details, as last fetched. */
export type DetailState = {
  id: string
  at: number
  /** a fetch is under way */
  loading: boolean
  data?: Detail
}

/** What the pane shows: one room or all, and the picked worker. */
export type View = {
  /** room key, or '' for the whole office */
  room: string
  /** worker id, or '' for nobody */
  selected: string
  /** a short message under the card, e.g. why a chat could not be opened */
  note: string
  /** show the click areas as blocks, to check they sit on the figures */
  debug: boolean
}

export type Office = {
  at: number
  rooms: Room[]
  /** set when the last poll failed; rooms keep the last good picture */
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'iso-office': { memory: Shaped<Memory>; office: Shaped<Office>; view: Shaped<View>; detail: Shaped<DetailState> }
  }
}
