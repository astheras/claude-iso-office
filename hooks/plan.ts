import type { PlanItem, PlanStatus } from '../types'

/**
 * A chat's task list, as the app showed it under its last message, rebuilt from the transcript. The list is set by a
 * tool call with the whole list (`items`), then moved on by short calls: `advance` (the step under way is done, the next
 * one starts), `done` + `start` (steps by number, from 1). The wrap-up call at the end of a turn checks the list off.
 */

const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
const WRAP_TOOL = 'mcp__ccd_turn__wrap_up'

const STATUSES: PlanStatus[] = ['pending', 'in_progress', 'completed']

type Call = { id: string; name: string; input: Record<string, unknown> }

/** The plan and wrap-up calls of one transcript line; nothing for a line that is not the chat's own message. */
function callsOf(line: string): Call[] {
  let rec: { type?: string; isSidechain?: boolean; message?: { content?: unknown } }
  try {
    rec = JSON.parse(line)
  } catch {
    return []
  }
  // the transcript also keeps copies of what was sent to the model, not always in order: only the chat's own messages
  // count, and not those of a helper agent it ran
  if (rec?.type !== 'assistant' || rec.isSidechain) return []
  const content = rec.message?.content
  if (!Array.isArray(content)) return []
  const out: Call[] = []
  for (const c of content as Record<string, unknown>[]) {
    if (c?.type !== 'tool_use' || (c.name !== PLAN_TOOL && c.name !== WRAP_TOOL)) continue
    const input = c.input && typeof c.input === 'object' ? (c.input as Record<string, unknown>) : {}
    out.push({ id: String(c.id ?? ''), name: String(c.name), input })
  }
  return out
}

function listOf(items: unknown): PlanItem[] | undefined {
  if (!Array.isArray(items)) return undefined
  const out: PlanItem[] = []
  for (const it of items as Record<string, unknown>[]) {
    const text = typeof it?.content === 'string' ? it.content.trim() : ''
    if (!text) continue
    const status = STATUSES.includes(it.status as PlanStatus) ? (it.status as PlanStatus) : 'pending'
    out.push({ text, status })
  }
  return out.length ? out : undefined
}

function step(plan: PlanItem[], input: Record<string, unknown>): PlanItem[] {
  const next = plan.map(p => ({ ...p }))
  if (input.advance === true) {
    const cur = next.findIndex(p => p.status === 'in_progress')
    if (cur >= 0) next[cur]!.status = 'completed'
    const after = next.findIndex((p, i) => i > cur && p.status === 'pending')
    if (after >= 0) next[after]!.status = 'in_progress'
  }
  if (Array.isArray(input.done)) {
    for (const n of input.done) {
      const p = next[Number(n) - 1]
      if (p) p.status = 'completed'
    }
  }
  const start = Number(input.start)
  if (Number.isInteger(start) && next[start - 1]) {
    // one step under way at a time: one left running by the jump goes back to waiting
    for (const p of next) if (p.status === 'in_progress') p.status = 'pending'
    next[start - 1]!.status = 'in_progress'
  }
  return next
}

/**
 * The plan as it stands after the given transcript lines (oldest first), or nothing when the chat never made one. Lines
 * that are not readable, or not the chat's own, are passed over; a call seen twice counts once. A transcript read in
 * pieces passes what the earlier pieces made as `from`.
 */
export function planFrom(lines: string[], from?: PlanItem[]): PlanItem[] | undefined {
  let plan: PlanItem[] | undefined = from?.map(p => ({ ...p }))
  const seen = new Set<string>()
  for (const line of lines) {
    for (const call of callsOf(line)) {
      if (call.id) {
        if (seen.has(call.id)) continue
        seen.add(call.id)
      }
      if (call.name === WRAP_TOOL) {
        if (plan) plan = plan.map(p => ({ ...p, status: 'completed' }))
        continue
      }
      const list = listOf(call.input.items)
      if (list) plan = list
      else if (plan) plan = step(plan, call.input)
    }
  }
  return plan
}

/** How far the plan has got: steps done, and all of them. */
export function planCount(plan: PlanItem[]): { done: number; total: number } {
  return { done: plan.filter(p => p.status === 'completed').length, total: plan.length }
}

/** The same from the statuses alone, as a chat on the screen carries them: «3/7». */
export function planProgress(statuses: PlanStatus[]): string {
  return `${statuses.filter(s => s === 'completed').length}/${statuses.length}`
}

/** The mark before a step in the accordion. */
export const PLAN_MARK: Record<PlanStatus, string> = { completed: '✓', in_progress: '▶', pending: '○' }
