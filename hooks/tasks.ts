import type { BgTask } from '../types'

/**
 * What a chat has started in the background and has not been told is over: a command run with `run_in_background`, or a
 * Monitor that watches for something. The chat's turn ends while they go on, so the app calls it stopped; but it is
 * waiting for them, and the transcript says so. A task begins with a call (its description is there), the answer to the
 * call names it («Command running in background with ID: …», «Monitor started (task …»), and a notice ends it: a record
 * with `<task-notification>` that has a status («completed»), or says the monitor expired. A notice with no status is one
 * more event of a monitor that goes on.
 */

/** A task left open this long is taken for lost (the chat was restarted, the notice never came). */
export const MAX_TASK_MS = 12 * 3600_000

const COMMAND = /running in background with ID: ([A-Za-z0-9_-]+)/
const MONITOR = /Monitor started \(task ([A-Za-z0-9_-]+)/

type Block = Record<string, unknown>

/** The text of a message's content: a string, or the text blocks of a list. */
function textOf(v: unknown): string {
  if (typeof v === 'string') return v
  if (!Array.isArray(v)) return ''
  return v.map(b => (b && typeof b === 'object' && typeof (b as Block).text === 'string' ? ((b as Block).text as string) : '')).join('\n')
}

/**
 * The tasks still open after the given transcript lines (oldest first). A transcript read in pieces passes what the earlier
 * pieces left open as `held`. Lines that are not readable, or not the chat's own, are passed over.
 */
export function tasksFrom(lines: string[], held: BgTask[] = []): BgTask[] {
  const open = new Map<string, BgTask>(held.map(t => [t.id, t]))
  // the calls that began a task, waiting for the answer that names it
  const starts = new Map<string, Omit<BgTask, 'id'>>()
  for (const line of lines) {
    let rec: Record<string, any>
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (!rec || typeof rec !== 'object' || rec.isSidechain === true) continue
    const at = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN
    const content = rec.message?.content

    if (rec.type === 'assistant' && Array.isArray(content)) {
      for (const b of content as Block[]) {
        if (b?.type !== 'tool_use') continue
        const input = b.input && typeof b.input === 'object' ? (b.input as Block) : {}
        if (b.name === 'TaskStop') {
          open.delete(String(input.task_id ?? ''))
          continue
        }
        if (b.name !== 'Monitor' && input.run_in_background !== true) continue
        const what = String(input.description ?? input.command ?? b.name).replace(/\s+/g, ' ').trim().slice(0, 120)
        starts.set(String(b.id ?? ''), {
          kind: b.name === 'Monitor' ? 'monitor' : 'bash',
          what,
          ...(Number.isFinite(at) ? { at } : {}),
          // a command that goes to an MCP server through a script says so in its description or its text
          ...(/mcp/i.test(JSON.stringify(input)) ? { mcp: true } : {}),
        })
      }
    } else if (rec.type === 'user' && Array.isArray(content)) {
      for (const b of content as Block[]) {
        if (b?.type !== 'tool_result') continue
        const start = starts.get(String(b.tool_use_id ?? ''))
        if (!start) continue
        const text = textOf(b.content)
        const id = COMMAND.exec(text)?.[1] ?? MONITOR.exec(text)?.[1]
        if (id) open.set(id, { id, ...start })
      }
    }

    // the notices, as a record of the chat or as the copy kept in the queue
    const text = typeof content === 'string' ? content : Array.isArray(content) ? textOf(content) : typeof rec.content === 'string' ? rec.content : ''
    for (const n of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
      const body = n[1]!
      const id = /<task-id>([^<]+)<\/task-id>/.exec(body)?.[1]
      if (id && (/<status>[^<]+<\/status>/.test(body) || /\[Monitor expired/.test(body))) open.delete(id)
    }
  }
  return [...open.values()].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
}

/** The tasks that are not too old to be believed. */
export const openTasks = (tasks: BgTask[] | undefined, now: number): BgTask[] => (tasks ?? []).filter(t => !t.at || now - t.at < MAX_TASK_MS)
