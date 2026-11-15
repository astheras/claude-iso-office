import { GROUP_COLOR, GROUP_MARK, GROUP_TITLE } from './data'
import type { GroupKey } from './data'
import { REST_COLOR } from './galaxy'

/**
 * The text of the «Легенда» tab: every state a chat can be in, what it means and how the picture shows it. Titles, colours
 * and glyphs come from the lists (`data.ts`), so the legend cannot say one thing while the lists say another; only the
 * words about the drawing are written here, and they follow the README.
 */

export type Theme = 'office' | 'galaxy'

export type LegendState = {
  key: GroupKey | 'rest' | 'home'
  title: string
  color: string
  mark: string
  /** what the state is */
  means: string
  /** how it is drawn in the theme asked for */
  looks: string
}

export type LegendMark = { name: string; text: string }

// in the office a chat is drawn at a desk or in the break area: only these three kinds have a picture of their own, the
// rest is told by the list under it
const OFFICE_LIST_ONLY = 'В офісі окремого вигляду немає: працівника видно за столом чи в зоні відпочинку, а цей стан — у списку на вкладці «Огляд».'

type Def = { key: LegendState['key']; means: string; galaxy: string; office: string }

const DEFS: Def[] = [
  {
    key: 'err',
    means: 'Остання відповідь чату — помилка API (відмовлена авторизація, збій сервера). Причина — поруч у списку. Зникає, коли чат відповість знову.',
    galaxy: 'Червона зірка з рваним спалахом.',
    office: OFFICE_LIST_ONLY,
  },
  {
    key: 'decide',
    means: 'Агент поставив вам питання з варіантами або план на затвердження і чекає. У списку, картці та деталях сказано, що саме.',
    galaxy: 'Рожева зірка з кільцем-маяком; уся система підсвічена м’яким рожевим диском, що дихає, з позначкою «чекає рішення».',
    office: OFFICE_LIST_ONLY,
  },
  {
    key: 'ask',
    means: 'Звичайний запит до вас, наприклад дозвіл на дію. Чат стоїть, поки ви не відповісте.',
    galaxy: 'Помаранчева зірка з кільцем-маяком, яке розкривається ширше, чим довше ви змушуєте чекати.',
    office: OFFICE_LIST_ONLY,
  },
  {
    key: 'agent',
    means: 'Чат зупинився й чекає іншого: або чат, який сам запустив і який ще працює, або колегу, якого про щось спитав і не дочекався відповіді. У списку написано, кого саме.',
    galaxy: 'Бузкова зірка: повільно обертається пунктирне кільце, а до кожної зірки, яку вона чекає (навіть в іншій галактиці), біжить лінія зі стрілкою. Та, яку чекають, має суцільне кільце.',
    office: OFFICE_LIST_ONLY,
  },
  {
    key: 'task',
    means: 'Чат зупинився, але те, що він запустив у фоні (команда, монітор), ще триває. Задача, що йде до MCP-сервера, позначена окремо.',
    galaxy: 'Бузкова зірка, навколо якої обертається ромб.',
    office: OFFICE_LIST_ONLY,
  },
  {
    key: 'work',
    means: 'Чат працює просто зараз. Якщо він застряг на виклику інструмента MCP-сервера, який ще не відповів, у списку, картці та деталях названо сервер і інструмент.',
    galaxy: 'Блакитна зірка, навколо якої обертаються дві білі дуги; далеко по колу повільно йде бузковий ромб, якщо чат чекає відповіді MCP-сервера.',
    office: 'Працівник за столом друкує: монітор світиться, над головою бульбашка з трьома крапками.',
  },
  {
    key: 'done',
    means: 'Чат щойно закінчив, а ви ще не глянули. Минає сам за 30 хвилин, або коли ви натиснули галочку чи «усі побачені».',
    galaxy: 'М’яко-зелена зірка.',
    office: 'Працівник стоїть біля столу з піднятою рукою та знаком «!».',
  },
  {
    key: 'rest',
    means: 'Чат стоїть, нічого не чекає й нікого не чекає. У списки не потрапляє, але його можна натиснути на картинці.',
    galaxy: 'Бліда біла зірка, що тьмяніє протягом дня.',
    office: 'Працівник ходить до кавомашини, балакає з колегою або сидить на дивані.',
  },
  {
    key: 'home',
    means: 'Чат простоює понад три доби. Проєкт, у якому всі чати «вдома», на картинці не показано взагалі.',
    galaxy: 'Тьмяні точки в гало галактики; кількість — під її назвою («згаслих»).',
    office: 'Не малюється: кількість — на написі кімнати.',
  },
]

const TITLE: Record<'rest' | 'home', string> = { rest: 'Простоюють', home: 'Вдома' }

const MARKS: Record<Theme, LegendMark[]> = {
  galaxy: [
    { name: 'Кільце навколо зірки', text: 'відкритий pull request.' },
    { name: 'Короткий спалах', text: 'зміна стану.' },
    { name: 'Розмір системи', text: 'скільки чат тримає в контексті, п’ять ступенів: від менш як 20k токенів до понад 400k. Чим більше — тим більші зірка, планети та орбіти.' },
    { name: 'Хмара навколо', text: 'скільки чат прочитав із кешу.' },
    { name: 'Планети', text: 'кроки списку задач чату: зроблений — з’єднаний із зіркою, поточний — пульсує, майбутній — пунктирний контур; коли всі зроблені, орбіта замикається в кільце. У списку — «план 3/7».' },
    { name: 'Менша зірка поруч', text: 'сесія, запущена іншою; у списку перед її назвою «↳».' },
  ],
  office: [
    { name: 'PR 34', text: 'відкритий pull request у чаті чи кімнаті.' },
    { name: '↳', text: 'сесія, запущена іншою (малюється меншою).' },
    { name: 'план 3/7', text: 'у чату є список задач: три кроки з семи зроблено.' },
  ],
}

/** Every state with its colour, glyph and the words for the theme asked for, and the marks that are not states. */
export function legend(theme: Theme): { states: LegendState[]; marks: LegendMark[] } {
  const states = DEFS.map(d => {
    const isGroup = d.key !== 'rest' && d.key !== 'home'
    return {
      key: d.key,
      title: isGroup ? GROUP_TITLE[d.key as GroupKey] : TITLE[d.key as 'rest' | 'home'],
      color: isGroup ? GROUP_COLOR[d.key as GroupKey] : REST_COLOR,
      mark: d.key === 'home' ? '⌂' : d.key === 'rest' ? GROUP_MARK.rest : GROUP_MARK[d.key as GroupKey],
      means: d.means,
      looks: theme === 'galaxy' ? d.galaxy : d.office,
    }
  })
  return { states, marks: MARKS[theme] }
}
