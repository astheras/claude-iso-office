# API рушія Claude Code

## Джерело правди

- Типи рушія — у `.claude-plugin/types/`: їх пише рушій під час завантаження плагіна, у git їх немає (`.gitignore`), `tsconfig.json` їх розширює.
- Перед новим викликом `$`, новою подією `on(...)` чи компонентом панелі — звірити з цими типами або зі skill `plugin-authoring`. Не вигадувати — `agents/workflow/no-guesswork-without-data.md`.

## Вхід

```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => { … })
  on('command.run', { command: 'office' }, async ($, e) => { … })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => { … })
}
```

Наявні події: `session.start`, `turn.start`, `turn.complete`, `command.run` (`/office`), `ui.render`.

## Атоми

- Оголошення: `atom({ plugin: 'iso-office', key } as const, початкове, { shape: '<key>-<N>' })`.
- `shape` — версія форми збереженого значення. Змінилась форма (поле додано, прибрано, змінило тип) — підняти номер: `view-4` → `view-5`.
- Те саме для кешу прочитаного з транскриптів: змінилась форма `Sketch` чи спосіб читання — підняти `SKETCH_VERSION` у `hooks/sketch.ts`.
- Кожен запис в атом перемальовує панель. Тому:
  - не писати значення, що не змінилось;
  - часи, що рухаються постійно, квантувати (`quantize`, крок 5 хв);
  - службовий стан, якого не видно (коли що читали), — у змінних модуля `register.tsx` (`detailFetchedAt`, `sketchReadAt`), не в атомі.

## Виклики `$`

- `$.process.run` — завжди з `timeoutMs`; перевіряти `exitCode`; помилку ловити й показувати коротко в `view.note`, не кидати далі.
- `$.mcp.call('ccd_session_mgmt', 'list_sessions' | 'get_session', …)` — відповідь розбирати обороняючись (`parseSessions`): `isError`, не той тип — нічого не показувати.
- Фонові читання не блокують опитування й не запускаються вдруге, поки йде перше: прапорці `isPolling`, `isCheckingErrors`, `isSketching`; завислий виклик відпускається через `STUCK_MS`.
- Сповіщення «сесія закінчила» — `$.ui.toast`; не для чату, в якому людина зараз.
