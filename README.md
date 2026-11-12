# iso-office

**English** | [Українська](README.uk.md)

An isometric mini-office for the Claude Code desktop app. Every project folder is a room, every session is a worker.

- **Working sessions** sit at a desk and type: the monitor is lit and a speech bubble with three dots floats over their head.
- **Sessions that just finished** stand at their desk with a raised hand and a "!" until you look at them. The **ок** ("ok") button, or **усі побачені** ("all seen"), clears it.
- **Idle sessions** leave their desk: they walk to the coffee machine, chat in pairs or sit on the sofa. When a session changes state, the worker walks between the desk and the break area.
- **Sessions idle for more than a day** go home: they are counted on the room's label instead of being drawn.
- **Click a worker** to see a card with the name of the chat, its project, PR and state, and a **Перейти в чат** ("Go to chat") button that opens that chat.
- **Click a room's name** (or its button at the top) to look at that room alone, larger.
- **Under the picture** the sessions are listed in groups, each with a title and its project name under it: **needs an answer** (orange), **in progress** (soft blue), **finished, waiting** (soft green). When a room is chosen at the top, only its sessions are listed.

The pane fills the width of the panel and grows when you widen it. Hover over a worker for a tooltip.

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
| `/office seen` | marks everyone who is waiting as seen |
| `/office debug` | shows the click areas as blocks (use it if clicks land beside the workers) |

## Compatibility

This is a **Claude Code** plugin, not a general tool. It uses Claude Code's plugin hooks and drawing API, and reads the session list from the Claude Code desktop app. It does not work with ChatGPT or other assistants: they have no such plugin API and no list of sessions for it to read. The scene drawing (`hooks/floor.ts`, `hooks/figures.ts`, `hooks/iso.ts`) is plain TypeScript that turns a list of rooms and workers into an SVG, so it can be reused elsewhere if you supply the data yourself.

## Limits

- It needs the **Claude Code desktop app** (it reads `list_sessions` from the app's session-management tools). In a plain terminal there is no picture, only a text roster.
- The interface text is in Ukrainian. The strings are in `hooks/data.ts` and `hooks/register.tsx`.
- **Перейти в чат** runs `cmd /c start` on the chat's `claude://` link, so it works on **Windows** only.
- The click areas over the picture are placed in the pane's character cells, measured for the default desktop font (a cell is about 7.5 px wide and 20 px tall). With another font size they can be off; `/office debug` shows where they are.
- The app does not tell a plugin that a session is waiting for you. "Finished, waiting" means: it was running, then stopped, and you have not pressed **ок** yet (it fades after 30 minutes).
- "Needs an answer" is read from the status that each running chat keeps in `~/.claude/sessions/*.json` (`waiting`: a permission or a question). If that file cannot be read, the group stays empty and nothing else changes.
- Sessions started from another one (forks) are drawn smaller.

## Develop

```
claude plugin test .
claude plugin validate .
```

The tests cover the session states and transitions (`hooks/data.test.ts`), the scene (`hooks/floor.test.ts`) and the pane (`hooks/register.test.tsx`). The engine writes `.claude-plugin/types/` when the plugin loads; it is not committed.

Keep `README.md` and `README.uk.md` in step: a change to one is made to the other.

## Licence

MIT
