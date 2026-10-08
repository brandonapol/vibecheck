/** Workflow commands GitHub Actions turns into annotations. Empty unless
 *  this process is the Actions runner and the check failed. */
export function githubAnnotationLines(
  failures: string[],
  env: Record<string, string | undefined>,
): string[] {
  if (!env.GITHUB_ACTIONS || failures.length === 0) return []
  return failures.map(failure => `::error::${failure.replace(/[ \t]*[\r\n]+[ \t]*/g, ' ')}`)
}
