# Модулі iso-office

Плагін — тека `hooks/` (код) і `types/index.d.ts` (спільні типи). Рушій завантажує модулі з `hooks/hooks.json` (`./register.tsx`); `tsconfig.json` розширює типи рушія з `.claude-plugin/types/`.

| Модуль | Що робить |
|--------|-----------|
| `hooks/register.tsx` | точка входу: атоми, опитування, команда `/office`, події `session.start` / `turn.start` / `turn.complete`, панель (`ui.render`, компонент `Pane`). **Єдине місце з вводом-виводом** (`$`) |
| `hooks/data.ts` | розбір `list_sessions` (`parseSessions`), кімнати (`roomOf`), класифікація сесій за опитування (`classify`), групи станів (`GROUP_DEFS`, `GROUP_COLOR`, `GROUP_TITLE`, `GROUP_MARK`), `WORD`, `HOME_MS`, `WAIT_MS` |
| `hooks/errors.ts` | помилки API й питання до колег з кінця транскрипту: `errorsScript` / `parseErrors` / `parsePeers`, кеш перевірених чатів |
| `hooks/sketch.ts` | інкрементальне читання транскриптів: план, токени, рішення, очікування MCP, фонові задачі (`sketchScript` / `parseSketches`, `SKETCH_VERSION`) |
| `hooks/detail.ts` | дані акордеону одного чату (`detailScript` / `parseDetail`, `detailRows`) і тексти станів для підказок і списків |
| `hooks/agents.ts` | субагенти чату: рядки PowerShell для `detailScript`, `parseAgents`, `agentRows` |
| `hooks/plan.ts` | план чату з викликів `update_plan` / `wrap_up` у транскрипті |
| `hooks/tasks.ts` | фонові задачі (команди, монітори) з транскрипту |
| `hooks/paths.ts` | де тека Claude (`CLAUDE_CONFIG_DIR`), вирази шляхів для PowerShell |
| `hooks/settings.ts` | `iso-office.json`: теми (`THEMES`), розбір і запис |
| `hooks/floor.ts`, `hooks/figures.ts`, `hooks/iso.ts` | тема «Офіс»: сцена, фігурки, ізометрія; спільні SVG-хелпери (`esc`, `hash`, `n1`) |
| `hooks/galaxy.ts` | тема «Галактика»; `steady()` проти перемальовування без змін |
| `hooks/legend.ts` | вкладка «Легенда» |
| `hooks/current.ts` | смуга поточної сесії в списку |
| `hooks/tip.ts`, `hooks/icons.ts` | підказка-картка над зорею; іконки списку з `<title>` |
| `types/index.d.ts` | типи, що ходять між модулями: `RawSession`, `Worker`, `Room`, `Detail`, `Sketch` тощо |

## Куди класти зміни

- Ввід-вивід (`$.mcp`, `$.process`, `$.fs`, `$.env`, `$.clock`, `$.ui`) — лише в `register.tsx`. Решта модулів — чисті функції від даних і часу (`now` передається параметром), з тестом поруч.
- Новий читач даних Claude — пара `xxxScript()` (будує PowerShell) + `parseXxx()` (розбирає вивід) у модулі своєї теми, обидві з тестом; запуск — у `register.tsx` — `agents/plugin/shell-scripts.md`.
- Тип, що ходить між модулями, — у `types/index.d.ts`; локальний — у модулі.
- Новий стан сесії — `agents/ui/states-and-themes.md`.
- Малюнок теми — у модулі теми (`floor.ts` / `galaxy.ts`), не в `register.tsx`.
- `claude-code` імпортує лише `register.tsx`; тести — `claude-code/testing`.

## Не робити

- Не переносити логіку класифікації чи розбору в `register.tsx` — там лише виклики й розкладка панелі.
- Не створювати нові модулі «на виріст»: новий модуль — коли є окрема тема з власними функціями й тестом.
