/** How a chat's last turn failed: the last thing it said was an API error, e.g. a refused sign-in. */
export type SessionError = {
  /** the app's code for it: authentication_failed, server_error, rate_limit... */
  code: string
  /** the HTTP status, when there was one */
  status?: number
  /** the message the chat showed */
  text: string
  /** when it happened (ms) */
  at: number
}

/** The transcripts already checked for an error: per chat, the activity time the check was made at, and what it found. */
/** What a chat is waiting for from another one: the chat, and what it is about ("Unity"), when that is known. */
export type WaitItem = { id: string; title: string; on?: string }

/** A chat that is running but held up by a call to a tool of an MCP server that has not returned: which server and tool, and since when (ms). */
export type McpWait = { server: string; tool: string; at?: number }

/**
 * What the agent has put to the person and waits on: a question with options (`AskUserQuestion`), or a plan to approve
 * (`ExitPlanMode`). `at` is when the call was made (ms). Read from the end of the transcript, a call nothing has answered.
 */
export type Decision = { kind: 'question' | 'plan'; at?: number }

/**
 * The question a chat ended its last turn on: the `ask` of its wrap-up box, which the app keeps in the chat's own file
 * (`turnWrapUp.needsUser`). Nothing blocks on it (the registry says idle, no call is open): the chat has stopped and the
 * next move is the person's. `at` is when that turn ended (ms).
 */
export type TurnAsk = { text: string; at?: number }

/**
 * Work a chat started in the background and has not been told is over: a command run in the background, or a monitor.
 * `what` is its description; `mcp` says the command goes to an MCP server (its text names one); `at` is when it began (ms).
 */
export type BgTask = { id: string; kind: 'bash' | 'monitor'; what: string; at?: number; mcp?: boolean }

/** A request a chat sent to a colleague chat that has not been answered: who it went to and what it said. */
export type PeerAsk = { to: string; id: string; text: string; at: number }

export type ErrorCache = Record<string, { at: string; error?: SessionError; peer?: PeerAsk }>

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
  /** the chat's last turn ended in an API error (read from its transcript) */
  error?: SessionError
  /** chats it waits for (an unanswered request to a colleague chat, read from its transcript) */
  waitsFor?: WaitItem[]
  /** the statuses of the chat's task list, in order (read from its transcript) */
  plan?: PlanStatus[]
  /** the call to an MCP tool its transcript ends on, not yet answered */
  mcp?: McpWait
  /** the question or plan its transcript ends on, not yet answered */
  decision?: Decision
  /** the question its last turn ended on (read from the chat's own file) */
  turnAsk?: TurnAsk
  /** what it started in the background and is still open, read from its transcript */
  tasks?: BgTask[]
  /** how big its output and its cache are, in steps (read from its transcript) */
  weight?: { size: number; haze: number }
}

/** work: running now. wait: finished lately and not yet looked at. rest: idle. home: idle over three days. */
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
  /** it has stopped, but chats it started are still running: it waits for them */
  waitsFor?: WaitItem[]
  /** failed: listed first, whatever its kind */
  error?: SessionError
  /** a session started from another one that is in the list: drawn as an intern */
  parentId?: string
  /** the statuses of its task list, in order; absent when it has none or it is not known */
  plan?: PlanStatus[]
  /** blocked on the person AND the agent has put a decision to them (a question with options, a plan): its own list */
  decision?: Decision
  /** it has stopped on a question to the person that nothing blocks on: its own list, "need a decision" */
  turnAsk?: TurnAsk
  /** it is running, but held up by an MCP tool that has not answered */
  mcp?: McpWait
  /** it has stopped, but what it started in the background is still going: it waits for that */
  tasks?: BgTask[]
  /** how much it has written, 0..4 (steps of the output tokens): the size of its star */
  size?: number
  /** how much it has read from the cache, 0..3: the cloud around its star */
  haze?: number
}

export type Room = {
  key: string
  name: string
  type: 'project' | 'remote' | 'cowork'
  /** workers sitting at desks: every kind except home, busiest first */
  workers: Worker[]
  /** sessions idle over three days: not drawn, counted on the door */
  homeCount: number
  /** open pull requests of the room's sessions */
  prNumbers: number[]
  /** the project's folder as its sessions give it (projects only): where a new session in it is started */
  cwd?: string
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

/** A step of a chat's task list, as the app shows it under the chat's last message. */
export type PlanStatus = 'pending' | 'in_progress' | 'completed'
export type PlanItem = { text: string; status: PlanStatus }

/** What was read of a chat's transcript so far: how far, and what it said about the chat's task list and its tokens. */
export type Sketch = {
  /** the activity time the read was made at */
  at: string
  /** how many bytes of the transcript are read, and how long it was then: more is read until the two meet */
  offset: number
  size: number
  /** the chat has no transcript on this machine (a cloud chat) */
  none?: boolean
  plan?: PlanItem[]
  /** tokens written, and read from the cache, as of the last finished turn */
  out?: number
  cache?: number
  /** how much the chat holds in its context: what its last reply was given to read */
  context?: number
  /** the MCP call the transcript ended on at that read, if it had not been answered */
  mcp?: McpWait
  /** the question or plan the transcript ended on at that read, if it had not been answered */
  decision?: Decision
  /** the question the chat's last turn ended on, as of that read */
  ask?: TurnAsk
  /** which version of the reader made this: an older one did not know every field, so the chat is read once more */
  v?: number
  /** the tasks started in the background that are still open, as of the end of what was read */
  tasks?: BgTask[]
}

export type SketchCache = Record<string, Sketch>

/**
 * A helper agent a chat started inside a turn (the `Agent` tool), read from the files Claude keeps beside the chat's transcript:
 * `<chat>/subagents/agent-*.meta.json` (the type, the task, whether it is over) and the tail of `agent-*.jsonl` (the model
 * it ran on, the call it is in the middle of). Not the same as a chat started from another chat, which is a session of its own.
 */
export type Subagent = {
  /** the id of the `Agent` call that started it */
  id: string
  /** its kind: Explore, Plan, general-purpose, or a custom agent's name */
  type: string
  /** the task it was given, in the few words the caller put in `description` */
  what?: string
  /** the model it really ran on, as its own transcript says; absent while that is not known */
  model?: string
  /** the model the caller asked for, as written («haiku»); absent when it let the agent pick */
  asked?: string
  /** its record says it is over */
  done: boolean
  /** when its transcript was last written to (ms): how long it has been quiet, or when it ended */
  at?: number
  /** the call it is in the middle of, as one short line («Read galaxy.ts»); only for one that is not over */
  doing?: string
  /** 1 for one the chat started itself, more for one that another helper started */
  depth?: number
}

/** What the accordion of a chosen chat shows; every field is optional, a missing one is left out of the rows. */
export type Detail = {
  /** the chat's task list as it stands now, read from its transcript */
  plan?: PlanItem[]
  /** the helper agents it has started, the ones still going first */
  agents?: Subagent[]
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
  /** how the work is drawn: the galaxies (the default), the isometric office, or nothing (the lists alone) */
  theme?: ThemeChoice
  /** the pane's tab: the picture with its lists (the default), the legend that explains every state, or the settings */
  tab?: 'main' | 'legend' | 'settings'
}

/** What the person may choose to see: no picture at all, the isometric office, or the galaxies. */
export type ThemeChoice = 'none' | 'office' | 'galaxy'

export type Office = {
  at: number
  rooms: Room[]
  /** set when the last poll failed; rooms keep the last good picture */
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'iso-office': { memory: Shaped<Memory>; office: Shaped<Office>; view: Shaped<View>; detail: Shaped<DetailState>; errors: Shaped<ErrorCache>; sketches: Shaped<SketchCache> }
  }
}
