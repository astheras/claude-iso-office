# Тести

## Як

- `import { expect, test } from 'claude-code/testing'`; запуск — `claude plugin test .`.
- Тест поруч з модулем: `data.ts` → `data.test.ts`. Панель — `register.test.tsx`: рушій підміняється обробниками `on('mcp.call' | 'fs.read' | 'process.run' | …)`, панель монтується і шукається через `ui.find` / `ui.findAll`.
- Назва тесту — речення англійською про поведінку: `'rooms come from the project folder'`, `'the first poll shows no finish events'`.
- Час — фіксований `NOW` (`Date.parse('2026-11-12T12:00:00Z')`), відносні часи — від нього. Чисті функції беруть `now` параметром, не `Date.now()`.

## Що покривати

- Нова чиста функція, новий стан, нова гілка розбору — тест.
- Виправлення бага — тест, що без виправлення падає.
- Кожен `xxxScript()` — тест, що він кидає на ін’єкцію (`"x'; Remove-Item *"`) і порожній id (`agents/plugin/shell-scripts.md`).
- Розбір (`parseXxx`) — і на порожній / битий / неочікуваний вивід.

## Дані — лише вигадані

Репозиторій публічний. Реальні назви чатів, шляхи, id сесій, рядки транскриптів і записів застосунку в тести не потрапляють — hard-stop (`agents/README.md`).

```ts
// ✅
const s = (id: string, over: Partial<RawSession> = {}): RawSession => ({
  sessionId: id,
  title: id,
  cwd: 'D:\\work\\my project',
  isRunning: false,
  lastActivityAt: iso(60_000),
  ...over,
})

// ❌ рядок, скопійований з реального транскрипту чи реального списку сесій
```

Зразок рядка транскрипту — мінімальний, зібраний вручну лише з полів, які розбирає код.
