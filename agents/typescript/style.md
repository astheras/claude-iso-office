# Стиль TypeScript

Форматера й лінтера в репо немає — стиль сусіднього коду.

## Форма

- 2 пробіли, одинарні лапки, **без `;`** в кінці рядків, кома в кінці багаторядкових списків.
- `type`, не `interface`. Типи імпортувати окремим `import type`.
- `any` у коді плагіна немає (лише в тестах): дані ззовні — `unknown` і перевірки `typeof`.
- Без зайвих порожніх рядків; файл закінчується одним переносом рядка.

## Імена

- Модуль — одне слово малими (`galaxy.ts`), тест поруч (`galaxy.test.ts`).
- Константи модуля — `UPPER_SNAKE_CASE` з одиницею в суфіксі: `POLL_MS`, `CELL_PX`, `TAIL_BYTES`.
- Нові `boolean` — з `is` / `has`: `isPolling`, `isCheckingErrors`, `hasLiveAgent`, `hasOpenPlan`. Наявні поля атомів (`debug`, `muted`) не перейменовувати — це зміна `shape` (`agents/plugin/engine-api.md`).
- Пара читача — `xxxScript` / `parseXxx`; малюнок — `xxxSvg`.

## Коментарі

Англійською, звичайними словами — як у наявному коді.

- `/** … */` над експортованою функцією чи типом: що це в термінах людини й застосунку.
- `//` — навіщо так, а не інакше (виміряне значення, обхід поведінки рушія), а не переказ коду.

```ts
// ✅
// a poll that has not answered in this long is taken for lost, so one hung call cannot stop the office for good
const STUCK_MS = 20000

// ❌
// timeout constant
const STUCK_MS = 20000
```
