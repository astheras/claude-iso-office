# iso-office

**English** | [Українська](README.uk.md)

An isometric mini-office for the Claude Code desktop app. Every project folder is a room, every session is a worker.

- **Working sessions** sit at a desk and type: the monitor is lit and a speech bubble with three dots floats over their head.
- **Sessions that just finished** stand at their desk with a raised hand and a "!" until you look at them. The **ок** ("ok") button, or **усі побачені** ("all seen"), clears it.
- **Idle sessions** leave their desk: they walk to the coffee machine, chat in pairs or sit on the sofa. When a session changes state, the worker walks between the desk and the break area.
- **Sessions idle for more than three days** go home: they are counted on the room's label instead of being drawn. A project with no session newer than that is not shown at all.
- **Click a worker** (or its title in the list below) to open an accordion under that chat: its state and how long it has lasted, what it cost, its tokens, the context fill, the model, the number of turns, how long it has run, the code it changed, the branch, the PR and the folder. Click again to close it. Cost and tokens are as of the end of the last turn.
- **The arrow** after a chat's project name opens that chat (its tooltip reads **Перейти в чат**, "Go to chat"). A finished session also has a tick that marks it as seen.
- **Click a room's name** (or its button at the top) to look at that room alone, larger.
- **The «+» by a project's name** opens a new session in that project's folder, ready for your first message (it uses the app's own `claude://code/new?folder=…` link, as its «New Claude Code Session» menu entry does). It has a tooltip, and is shown for projects and for the coworking room (which has no folder: the app starts the session where it starts one by default), not for the remote office. The app asks once per folder whether to trust it (it keeps its own list of folders trusted for links from outside); after you agree it does not ask again. If the link cannot be opened, the reason is shown under the picture.
- **Under the picture** the sessions are listed in groups, each with a title and its project name under it: **with an error** (red, always first: a chat whose last reply was an API error such as a refused sign-in, with what went wrong beside it), **needs an answer** (orange), **waits for another agent** (lilac, with a line saying what it waits for: a chat it started that is still running, or a colleague chat it asked something and has not heard back from, such as «Unity (chat name)» when it asked for the Unity editor), **in progress** (soft blue), **finished, waiting** (soft green). When a room is chosen at the top, only its sessions are listed.

The pane fills the width of the panel and grows when you widen it. Hover over a worker for a tooltip.

## The galaxies theme

The galaxies are the default picture. `/office theme` switches to the isometric office (and back). The list under it, the accordion and the clicks work the same.

- **A project is a galaxy**, a session is a **star** in it. A project's sessions idle for more than three days are dim points in its halo, counted under its name («згаслих»).
- **The star's colour is the colour of its list**: red with an error (a ragged flash), orange when it needs an answer (a beacon ring that opens wider the longer you have been kept waiting), lilac when it waits for another agent (a dashed ring turns slowly round it and a flowing line with an arrow runs to each star it waits for, even in another galaxy; the star that is waited for has a solid ring, and its tooltip names who waits), soft blue while it works (two white arcs turn round it, so it reads on the blue sky; a lilac diamond goes slowly round far out when the call it is in the middle of is to a tool of an MCP server that has not answered yet, and the tooltip, the list and the details name the server and the tool), soft green when it has finished and waits for you, pale white when it merely idles (it fades through the day). A ring round a star is an open pull request; a short flash is a change of state.
- **The size of the system is how much its context holds** (what the chat's last reply was given to read), in five steps from under 20k tokens to over 400k: the more it holds, the bigger the star and, with it, its planets and orbits. **The cloud round it is how much it has read from the cache.**
- **A plan is planets.** A session that keeps a task list has one planet per step: a step done is joined to its star, the step under way pulses (while the session is working: a stopped session's planet stays still and takes the colour of the reason it stopped), a step to come is a dashed outline. When all the steps are done the orbit closes into a ring. With several galaxies on the screen the plan is drawn as a ring of marks round the star, one per step; choose a galaxy to see the planets.
- **Sessions started by another** stand beside it, in the same cluster.
- The list under the picture shows «план 3/7» for each chat that has a plan, and the accordion lists every step with its mark (✓ done, ▶ under way, ○ to come).

The plan, the context and the tokens are read from each chat's transcript, from where the last read stopped (so big transcripts cost a read once), at most every 20 seconds for a chat that is running.

## Install

At the prompt of a terminal session:

```
/plugin install iso-office --marketplace astheras/claude-iso-office
```

From a shell:

```
claude plugin install iso-office --marketplace astheras/claude-iso-office
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `astheras/claude-iso-office`, then **Add plugin**.

## Use

| Command | What it does |
| --- | --- |
| `/office` | opens the Office pane |
| `/office mute`, `/office unmute` | turns the "session finished" toasts off and on |
| `/office theme [office\|galaxy]` | switches the picture between the office and the galaxies (no argument: the other one) |
| `/office seen` | marks everyone who is waiting as seen |
| `/office debug` | shows the click areas as blocks (use it if clicks land beside the workers) |

## Compatibility

This is a **Claude Code** plugin, not a general tool. It uses Claude Code's plugin hooks and drawing API, and reads the session list from the Claude Code desktop app. It does not work with ChatGPT or other assistants: they have no such plugin API and no list of sessions for it to read. The scene drawing (`hooks/floor.ts`, `hooks/figures.ts`, `hooks/iso.ts`, `hooks/galaxy.ts`) is plain TypeScript that turns a list of rooms and workers into an SVG, so it can be reused elsewhere if you supply the data yourself.

## Limits

- It needs the **Claude Code desktop app** (it reads `list_sessions` from the app's session-management tools). In a plain terminal there is no picture, only a text roster.
- The interface text is in Ukrainian. The strings are in `hooks/data.ts` and `hooks/register.tsx`.
- The arrow that opens a chat runs `cmd /c start` on the chat's `claude://` link, so it works on **Windows** only.
- The accordion's cost, tokens and turn count are read from the app's own files (the chat's record under `Claude-Data` and the last `cost-state` line of its transcript in `~/.claude/projects`) by a short PowerShell run, also **Windows** only. If a file cannot be read, those lines are left out; the rest still shows.
- The click areas over the picture are placed in the pane's character cells, measured for the default desktop font (a cell is about 7.5 px wide and 20 px tall). With another font size they can be off; `/office debug` shows where they are.
- The app does not tell a plugin that a session is waiting for you. "Finished, waiting" means: it was running, then stopped, and you have not pressed **ок** yet (it fades after 30 minutes).
- "With an error" is read from the end of the chat's transcript (`~/.claude/projects`, the last 256 KB) by a short PowerShell run, **Windows** only: a chat is in error when it has stopped and its last reply is flagged as an API error. Each chat is read once per activity, not on every poll, and the error clears itself when the chat answers again. If a transcript cannot be read, that chat is simply not marked.
- "Needs an answer" is read from the status that each running chat keeps in `~/.claude/sessions/*.json` (`waiting`: a permission or a question). If that file cannot be read, the group stays empty and nothing else changes.
- Sessions started from another one (forks) are drawn smaller.
- A chat's plan is rebuilt from the task-list calls of its transcript (`update_plan` and the wrap-up that checks the list off), by a short PowerShell run, **Windows** only. A chat with no transcript on this machine (a cloud chat) has no plan and no token sizes: its star is drawn plain. The end of a turn marks the whole list done, as the app does.
- The galaxies need the drawing surface to support gradients, blur, noise, masks and animation; the desktop pane does.

## Develop

```
claude plugin test .
claude plugin validate .
```

The tests cover the session states and transitions (`hooks/data.test.ts`), the office scene (`hooks/floor.test.ts`), the galaxies (`hooks/galaxy.test.ts`), the plan read from a transcript (`hooks/plan.test.ts`, `hooks/sketch.test.ts`) and the pane (`hooks/register.test.tsx`). The engine writes `.claude-plugin/types/` when the plugin loads; it is not committed.

Keep `README.md` and `README.uk.md` in step: a change to one is made to the other.

## Licence

MIT
