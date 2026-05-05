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

export async function fileExistsInBranch(file: string, branch: string): Promise<boolean> {
  try {
    await execa('git', ['show', `origin/${branch}:${file}`])
    return true
  } catch {
    return false
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
