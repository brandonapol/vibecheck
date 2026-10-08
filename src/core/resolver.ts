import { execa } from 'execa'
import micromatch from 'micromatch'

export function matchesPatterns(file: string, patterns: string[]): boolean {
  return micromatch.isMatch(file, patterns)
}

export async function getStagedFiles(): Promise<string[]> {
  const result = await execa('git', ['diff', '--cached', '--name-only'])
  if (!result.stdout) return []
  return result.stdout.split('\n')
}

function gitText(err: unknown): string {
  return `${(err as { stderr?: string }).stderr ?? ''}\n${(err as Error).message ?? ''}`
}

/** Git ran, and the path is simply not in that tree. Anything else is a failure. */
export function gitPathAbsent(err: unknown): boolean {
  return /exists on disk, but not in|does not exist in /.test(gitText(err))
}

function gitRefMissing(err: unknown): boolean {
  return /invalid object name|bad revision|unknown revision|ambiguous argument/.test(gitText(err))
}

const warnedFallback = new Set<string>()

async function showFile(ref: string, file: string): Promise<boolean> {
  try {
    await execa('git', ['show', `${ref}:${file}`])
    return true
  } catch (err) {
    if (gitPathAbsent(err)) return false
    if (gitRefMissing(err)) throw err
    const stderr = (err as { stderr?: string }).stderr ?? (err as Error).message
    throw new Error(
      `Could not check whether '${file}' exists on '${ref}'. ` +
        `Treating a git failure as "unprotected" would skip enforcement. ${stderr}`,
    )
  }
}

export async function fileExistsInBranch(file: string, branch: string): Promise<boolean> {
  const remote = `origin/${branch}`
  try {
    return await showFile(remote, file)
  } catch (err) {
    if (!gitRefMissing(err)) throw err
    if (!warnedFallback.has(branch)) {
      warnedFallback.add(branch)
      console.warn(`vibecheck: '${remote}' is not available; using local '${branch}'.`)
    }
    try {
      return await showFile(branch, file)
    } catch (localErr) {
      if (gitRefMissing(localErr)) {
        throw new Error(
          `Protected branch '${branch}' was not found as '${remote}' or '${branch}'. ` +
            `Fetch it (\`git fetch origin ${branch}\`) or every test file would look unprotected.`,
        )
      }
      throw localErr
    }
  }
}

export async function getProtectedPaths(
  stagedFiles: string[],
  testPatterns: string[],
  protectedBranch: string,
): Promise<string[]> {
  const testFiles = stagedFiles.filter(f => matchesPatterns(f, testPatterns))
  if (testFiles.length === 0) return []

  const results = await Promise.all(
    testFiles.map(async f => {
      const exists = await fileExistsInBranch(f, protectedBranch)
      return exists ? f : null
    }),
  )

  return results.filter((f): f is string => f !== null)
}
