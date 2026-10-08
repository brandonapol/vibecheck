import { execa } from 'execa'
import { readFile } from 'node:fs/promises'
import { gitPathAbsent } from '../core/resolver.js'

function detail(err: unknown): string {
  const stderr = (err as { stderr?: string }).stderr
  return (stderr || (err as Error).message || 'unknown error').trim()
}

/** CI audits the commit that was checked out. A local run audits the working tree. */
export function auditTarget(env: Record<string, string | undefined>): 'HEAD' | 'worktree' {
  return env.CI ? 'HEAD' : 'worktree'
}

/** Files changed between `baseRef` and the worktree, or `toRef` when given.
 *  A git failure is an error: an empty list would make every protected test look untouched. */
export async function getChangedFiles(
  baseRef: string,
  toRef?: string,
  options?: { noRenames?: boolean },
): Promise<string[]> {
  try {
    // Rename detection keeps only the new path, so a renamed test never
    // shows up as a deletion. Callers that score deletions pass noRenames.
    const args = ['diff', '--name-only']
    if (options?.noRenames) args.push('--no-renames')
    args.push(baseRef)
    if (toRef) args.push(toRef)
    const { stdout } = await execa('git', args)
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

/** The file as audited: `HEAD` in CI, the working tree locally. `null` means it is absent. */
export async function readAuditedFile(file: string, target: 'HEAD' | 'worktree'): Promise<string | null> {
  if (target === 'HEAD') {
    const text = await getFileAtRef(file, 'HEAD')
    return text.length > 0 ? text : null
  }
  try {
    return await readFile(file, 'utf-8')
  } catch {
    return null
  }
}

/** Paths whose contents contain `needle`. Exit 1 is "no hits", not a failure.
 *  `HEAD` searches the commit; `git grep` prefixes those paths with `HEAD:`. */
export async function listWorktreeFilesContaining(
  needle: string,
  target: 'HEAD' | 'worktree' = 'worktree',
): Promise<string[]> {
  const args = ['grep', '-l', '-I', '-F', '-e', needle]
  if (target === 'HEAD') args.push('HEAD')
  const result = await execa('git', args, { reject: false })
  if (result.exitCode === 1) return []
  if (result.exitCode !== 0) {
    throw new Error(
      `Could not search the worktree for '${needle}'. ` +
        (result.stderr || `git grep exited ${result.exitCode}`),
    )
  }
  return result.stdout.split('\n').filter(Boolean).map(path => path.replace(/^HEAD:/, ''))
}
