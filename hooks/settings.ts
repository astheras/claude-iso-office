import type { ThemeChoice } from '../types'

/**
 * The pane's settings, kept in a file of their own (`iso-office.json` in Claude's folder) so that they outlive the session:
 * the atoms of the pane are gone with it. The file is plain JSON a person may edit by hand; whatever in it is missing or
 * wrong is taken as the default, and a file that is not JSON at all changes nothing.
 */

export type Settings = {
  /** how the work is drawn: nothing (the lists alone), the isometric office, or the galaxies */
  theme: ThemeChoice
}

export const DEFAULT_SETTINGS: Settings = { theme: 'galaxy' }

/** The name of the file, in the folder of Claude's files. */
export const SETTINGS_FILE = 'iso-office.json'

/** What the «Налаштування» tab offers for the theme, in the order shown: the name, and a line under it. */
export const THEMES: { key: ThemeChoice; title: string; hint: string }[] = [
  { key: 'none', title: 'Відсутня', hint: 'Без графіки: лише списки сесій під вкладками.' },
  { key: 'office', title: 'Офіс', hint: 'Ізометричний офіс: проєкт — кімната, сесія — працівник.' },
  { key: 'galaxy', title: 'Галактика', hint: 'Небо галактик: проєкт — галактика, сесія — зірка, кроки плану — планети.' },
]

export const isTheme = (v: unknown): v is ThemeChoice => THEMES.some(t => t.key === v)

/** The settings a file's text holds; anything missing or not understood is the default. */
export function parseSettings(text: string): Settings {
  try {
    const j: unknown = JSON.parse(text)
    const theme = j && typeof j === 'object' ? (j as { theme?: unknown }).theme : undefined
    return { theme: isTheme(theme) ? theme : DEFAULT_SETTINGS.theme }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** The text of the file for these settings: indented, with a closing newline, easy to read and to edit. */
export const serializeSettings = (s: Settings): string => `${JSON.stringify({ theme: s.theme }, null, 2)}\n`

/** Where the file is, given the folder of Claude's files (forward slashes, none at the end). */
export const settingsPath = (claudeFolder: string): string => `${claudeFolder}/${SETTINGS_FILE}`
