# Що в проєкті не використовується

Загальні TypeScript-рекомендації часто пропонують інструменти й підходи, які тут свідомо **не** застосовуються. Не додавати їх із загальних знань — лише за окремим рішенням користувача.

| Не використовуємо | Натомість | Чому |
|-------------------|-----------|------|
| `package.json`, npm-залежності, бандлер, `tsc`-збірка | лише `claude-code` від рушія і власний код | рушій сам завантажує `.ts` / `.tsx` з теки плагіна |
| Node API (`fs`, `child_process`, `path`), `fetch` | `$.fs`, `$.process.run`, `$.mcp.call` у `register.tsx` | увесь ввід-вивід — через API рушія, в одному місці (`agents/architecture/modules.md`) |
| Мережеві виклики | — | усе локальне: файли Claude і `list_sessions` |
| Jest, Vitest та інші раннери | `claude-code/testing` + `claude plugin test .` | `agents/typescript/tests.md` |
| Бібліотеки графіки (D3, React-компоненти SVG тощо) | SVG-рядки з власних хелперів (`hooks/iso.ts`, `hooks/figures.ts`) | панель приймає готовий SVG |
| bash / sh, кросплатформні обгортки | `powershell -NoProfile -NonInteractive`, `cmd /c start` | плагін працює лише у Windows (`agents/plugin/shell-scripts.md`) |
| Prettier, ESLint | стиль сусіднього коду | конфігів у репо немає (`agents/typescript/style.md`) |
| Файл перекладів, i18n | рядки поруч з кодом, українською | `agents/ui/strings.md` |

Якщо задача, на думку агента, потребує чогось із цього списку — зупинитись і запитати, не додавати самостійно.
