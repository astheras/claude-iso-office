# Коміти, push і версія

## Коли

Лише коли користувач просить закомітити чи запушити (`agents/workflow/no-changes-without-explicit-request.md`).

## Куди

Прямо в `main`: користувач один, гілки й PR не потрібні. Push у `main` — коли просять.

## Повідомлення

Англійською, як уся історія.

- Тема — що тепер бачить або може людина, звичайними словами, у наказовому способі. Без префіксів (`feat:`, `fix(...)`), без крапки в кінці.
- Тіло — що було не так і що змінилось, чому саме так; рядки до ~75 символів.
- В кінці — рядок `Co-Authored-By:` агента, як у попередніх комітах.

```text
✅ Show a chat's helper agents in its accordion
✅ Draw the current session's band in the flow, not over the row
❌ feat(detail): add subagents support
❌ Refactor register.tsx
```

- Одна видима зміна — один коміт; код, тести й обидва README — разом.

## Версія

`version` у `.claude-plugin/plugin.json` піднімати **лише за явним запитом**.

## Не комітити

Те, що в `.gitignore`: `.claude-plugin/types/` (пише рушій під час завантаження), `.mcpb-cache/`, `*.log`.
