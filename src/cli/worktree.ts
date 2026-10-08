import { execa } from 'execa'
import { gitPathAbsent } from '../core/resolver.js'

function detail(err: unknown): string {
  const stderr = (err as { stderr?: string }).stderr
  return (stderr || (err as Error).message || 'unknown error').trim()
}

/** Files changed between `baseRef` and the worktree. A git failure is an error:
 *  an empty list would make every protected test look untouched. */
export async function getChangedFiles(baseRef: string): Promise<string[]> {
  try {
    const { stdout } = await execa('git', ['diff', '--name-only', baseRef])
    return stdout.split('\n').filter(Boolean)
  } catch (err) {
    throw new Error(
      `Could not list files changed since '${baseRef}'. ` +
        `Fetch the ref (in CI, checkout with fetch-depth: 0) so a git failure is not an empty diff. ` +
        detail(err),
    )
  }
}

/** File contents at `ref`. A path that is simply absent (a new file) is `''`.
 *  Any other git failure throws, so a missing ref is not read as an empty base. */
export async function getFileAtRef(file: string, ref: string): Promise<string> {
  try {
    const { stdout } = await execa('git', ['show', `${ref}:${file}`])
    return stdout
  } catch (err) {
    if (gitPathAbsent(err)) return ''
    throw new Error(
      `Could not read '${file}' from '${ref}'. A git failure must not look like a new file. ` +
        detail(err),
    )
  }
}

/** Worktree paths whose contents contain `needle`, via `git grep`. Exit 1 is
 *  "no hits", not a failure. Anything else aborts the check. */
export async function listWorktreeFilesContaining(needle: string): Promise<string[]> {
  const result = await execa('git', ['grep', '-l', '-I', '-F', '-e', needle], { reject: false })
  if (result.exitCode === 1) return []
  if (result.exitCode !== 0) {
    throw new Error(
      `Could not search the worktree for '${needle}'. ` +
        (result.stderr || `git grep exited ${result.exitCode}`),
    )
  }
  return result.stdout.split('\n').filter(Boolean)
}
