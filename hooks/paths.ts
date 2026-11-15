/**
 * Where Claude keeps its files, so that moving them (to another disk, say) does not blind the pane.
 *
 * `~/.claude` (transcripts in `projects/`, the live registry in `sessions/`) is wherever CLAUDE_CONFIG_DIR says, else
 * `%USERPROFILE%\.claude`; a folder moved with a junction or a symlink left at the old place needs nothing. The app's own
 * record of each chat (`Claude-Data`) stays under `%LOCALAPPDATA%`: the app asks that it is neither moved nor renamed.
 */

/** PowerShell that sets `$cd` to the folder of Claude's files; no double quote, so that no argument quoting can change it. */
export const CLAUDE_DIR_PS = "$cd = $env:CLAUDE_CONFIG_DIR; if (-not $cd) { $cd = $env:USERPROFILE + '\\.claude' }"

/** A PowerShell expression for the glob of a chat's transcript, given the PowerShell expression of its CLI session id. */
export const transcriptGlobPs = (cliIdExpr: string): string => `($cd + '\\projects\\*\\' + ${cliIdExpr} + '.jsonl')`

/** The folder of Claude's files, as the plugin's own reads (not PowerShell) see it: forward slashes, no trailing one. */
export function claudeDir(env: { configDir?: string; home?: string }): string | undefined {
  const base = env.configDir || (env.home ? `${env.home}/.claude` : '')
  const dir = base.replace(/\\/g, '/').replace(/\/+$/, '')
  return dir || undefined
}
