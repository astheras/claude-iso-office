# PowerShell і `cmd`

Плагін працює лише у Windows. Файли Claude, які не прочитати через `$.fs` (пошук за маскою, хвіст великого файлу), читаються одним запуском PowerShell; посилання `claude://` відкриваються через `cmd /c start`.

## Запуск

```ts
await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', detailScript(id)], { timeoutMs: 20000 })
await $.process.run(['cmd', '/c', 'start', '', link])
```

- Запуск — лише в `register.tsx`; текст скрипта будує чиста функція `xxxScript()` у модулі теми.
- Один запуск на всі чати, а не процес на чат.
- Невдалий запуск запам’ятовується до зміни чату, щоб не запускати зламану оболонку кожні 5 с (як `refreshErrors`).

## Whitelist перед підстановкою — обов’язково

Будь-яке значення ззовні, що потрапляє в текст скрипта чи в команду, перевіряється whitelist-регексом **до** підстановки. Не пройшло — `throw` у `xxxScript()` або `view.note` і нічого не запускати.

| Значення | Перевірка |
|----------|-----------|
| id сесії | `/^[A-Za-z0-9_-]+$/` |
| офсет | `Number.isInteger(x) && x >= 0` |
| посилання на чат | `/^claude:\/\/[A-Za-z0-9._\/-]+$/` |
| нова сесія | `/^claude:\/\/code\/new(\?folder=[A-Za-z0-9._~%-]+)?$/` |

```ts
// ✅
if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error('not a session id')
return [..., `$id = '${sessionId}'`, ...].join('\n')

// ❌ екранування замість whitelist; значення без перевірки
const id = sessionId.replace(/'/g, "''")
```

Нове значення в скрипті — новий рядок у таблиці й тест, що `xxxScript()` кидає на `"x'; Remove-Item *"`.

## Текст скрипта

- Перші рядки: `$ErrorActionPreference = 'SilentlyContinue'` і `[Console]::OutputEncoding = [Text.Encoding]::UTF8`.
- **Без подвійних лапок** у тексті: `"` дає `$q = [char]34`. Тоді передача аргументу не змінить скрипт.
- Тека Claude — `CLAUDE_DIR_PS`, транскрипт чату — `transcriptGlobPs(...)` з `hooks/paths.ts`; не збирати ці шляхи заново.
- Вивід — JSON у stdout; розбір — `parseXxx()`, що не кидає на невідомі поля й порожній вивід.
- Читати шматок або хвіст (`-Tail`, офсет), а не весь файл — `agents/plugin/app-data-sources.md`.
