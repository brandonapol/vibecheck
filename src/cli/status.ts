import { matchesPatterns } from '../core/resolver.js'

export type StatusFile = {
  path: string
  state: 'protected' | 'new'
}

export async function collectStatus(
  files: string[],
  testPatterns: string[],
  existsOnProtectedBranch: (file: string) => Promise<boolean>,
): Promise<StatusFile[]> {
  const tests = files.filter(file => matchesPatterns(file, testPatterns)).sort()
  const status: StatusFile[] = []
  for (const path of tests) {
    status.push({ path, state: (await existsOnProtectedBranch(path)) ? 'protected' : 'new' })
  }
  return status
}

/** Grouped by directory. `protected` exists on the protected branch; `new` does not. */
export function formatStatus(files: StatusFile[]): string {
  if (files.length === 0) return 'vibecheck: no test files match the configured patterns'

  const groups = new Map<string, StatusFile[]>()
  for (const file of files) {
    const slash = file.path.lastIndexOf('/')
    const dir = slash === -1 ? '' : file.path.slice(0, slash + 1)
    const list = groups.get(dir) ?? []
    list.push(file)
    groups.set(dir, list)
  }

  const lines = ['vibecheck: test protection', '']
  for (const dir of [...groups.keys()].sort()) {
    lines.push(dir === '' ? '(repo root)' : dir)
    for (const file of groups.get(dir) ?? []) {
      const name = dir === '' ? file.path : file.path.slice(dir.length)
      const label = file.state === 'protected' ? 'protected' : 'new      '
      lines.push(`  ${label}  ${name}`)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}
