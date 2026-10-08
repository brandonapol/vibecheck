export type CliCommand = {
  command: 'check' | 'score' | 'report' | 'init' | 'status' | 'help'
  flags: {
    mutation?: boolean
    semantic?: boolean
    threshold?: number
    base?: string
    /** Pre-commit entry: staged files and enforcement, no analyzers. */
    hook?: boolean
  }
}

const VALID_COMMANDS = new Set(['check', 'score', 'report', 'init', 'status'])

export function parseArgs(args: string[]): CliCommand {
  const [command, ...rest] = args

  if (!command || !VALID_COMMANDS.has(command)) {
    return { command: 'help', flags: {} }
  }

  const flags: CliCommand['flags'] = {}

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--mutation') flags.mutation = true
    else if (arg === '--semantic') flags.semantic = true
    else if (arg === '--threshold' && i + 1 < rest.length) {
      flags.threshold = Number(rest[++i])
    } else if (arg === '--base' && i + 1 < rest.length) {
      flags.base = rest[++i]
    } else if (arg === '--hook') flags.hook = true
  }

  return { command: command as CliCommand['command'], flags }
}
