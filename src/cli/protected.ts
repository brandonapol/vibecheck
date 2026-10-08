import { matchesPatterns } from '../core/resolver.js'

export type Protection = 'protected' | 'unprotected' | 'not-a-test'

export async function protectionFor(
  file: string,
  testPatterns: string[],
  existsOnProtectedBranch: (file: string) => Promise<boolean>,
): Promise<Protection> {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!matchesPatterns(normalized, testPatterns)) return 'not-a-test'
  return (await existsOnProtectedBranch(normalized)) ? 'protected' : 'unprotected'
}

export function protectedMessage(file: string, branch: string): string {
  return `vibecheck: ${file} is protected. It exists on '${branch}'. Do not edit it; change the implementation, or have a human review the test change. CI remains the enforcement boundary if this hook is removed.`
}
