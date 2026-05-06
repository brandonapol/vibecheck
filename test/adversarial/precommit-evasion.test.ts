import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execaSync } from 'execa'

/**
 * ADVERSARIAL TESTS: Attempts to bypass the pre-commit hook.
 * The hook blocks commits that mix test and implementation files.
 */

function setupRepo(hookContent: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'vibecheck-hook-'))
  execaSync('git', ['init'], { cwd: dir })
  execaSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir })
  execaSync('git', ['config', 'user.name', 'Test'], { cwd: dir })

  const hooksDir = join(dir, '.git', 'hooks')
  const hookPath = join(hooksDir, 'pre-commit')
  writeFileSync(hookPath, hookContent)
  chmodSync(hookPath, '755')

  return dir
}

function getHookScript(): string {
  // Simplified version of the actual hook for testing
  return `#!/bin/bash
STAGED=$(git diff --cached --name-only --diff-filter=ACM)
TEST_FILES=""
IMPL_FILES=""
for file in $STAGED; do
  if echo "$file" | grep -qE '\\.(test|spec)\\.(ts|tsx|js|jsx)$'; then
    TEST_FILES="$TEST_FILES $file"
  elif echo "$file" | grep -qE '\\.(ts|tsx|js|jsx)$'; then
    IMPL_FILES="$IMPL_FILES $file"
  fi
done
if [ -n "$TEST_FILES" ] && [ -n "$IMPL_FILES" ]; then
  echo "VIOLATION: mixed test and impl files"
  exit 1
fi
exit 0
`
}

describe('Pre-commit Hook Evasion Attacks', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  // =========================================================================
  // ATTACK 1: Use non-standard test file naming
  // Strategy: The hook checks for .test.ts and .spec.ts patterns.
  // Tests in __tests__/ directories without the .test. suffix are invisible.
  // =========================================================================
  it('LOOPHOLE: __tests__/foo.ts is not recognized as a test file', () => {
    dir = setupRepo(getHookScript())

    mkdirSync(join(dir, 'src', '__tests__'), { recursive: true })
    writeFileSync(join(dir, 'src', '__tests__', 'foo.ts'), 'test code')
    writeFileSync(join(dir, 'src', 'foo.ts'), 'impl code')

    execaSync('git', ['add', '.'], { cwd: dir })
    // Should block (mixed) but __tests__/foo.ts doesn't match *.test.ts
    const result = execaSync('git', ['commit', '-m', 'test'], { cwd: dir, reject: false })
    expect(result.exitCode).toBe(0) // LOOPHOLE: committed mixed files
  })

  // =========================================================================
  // ATTACK 2: Use .tsx extension for tests but .ts for implementation
  // This is actually caught by the hook since it checks both .ts and .tsx
  // =========================================================================
  it('CAUGHT: .tsx test files are recognized', () => {
    dir = setupRepo(getHookScript())

    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'Button.test.tsx'), 'test code')
    writeFileSync(join(dir, 'src', 'Button.tsx'), 'impl code')

    execaSync('git', ['add', '.'], { cwd: dir })
    const result = execaSync('git', ['commit', '-m', 'test'], { cwd: dir, reject: false })
    expect(result.exitCode).toBe(1) // Caught: blocked
  })

  // =========================================================================
  // ATTACK 3: Commit test as JSON fixture
  // Strategy: Put test logic in a .json file and import it. The hook only
  // checks .ts/.tsx/.js/.jsx extensions.
  // =========================================================================
  it('LOOPHOLE: test logic in .json fixtures bypasses extension check', () => {
    dir = setupRepo(getHookScript())

    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'foo.ts'), 'impl code')
    writeFileSync(join(dir, 'src', 'fixtures.json'), '{"expected": "value"}')

    execaSync('git', ['add', '.'], { cwd: dir })
    const result = execaSync('git', ['commit', '-m', 'feat'], { cwd: dir, reject: false })
    expect(result.exitCode).toBe(0) // LOOPHOLE: .json not tracked
  })

  // =========================================================================
  // ATTACK 4: Two-step commit gaming
  // Strategy: The hook is fine with this — commit tests first, then impl.
  // But the agent can commit EMPTY test files first, then modify them
  // alongside implementation in the second commit.
  // =========================================================================
  it('LOOPHOLE: commit empty test file, then modify test+impl together', () => {
    dir = setupRepo(getHookScript())

    mkdirSync(join(dir, 'src'), { recursive: true })

    // Step 1: commit empty test file (allowed — test-only commit)
    writeFileSync(join(dir, 'src', 'foo.test.ts'), '// placeholder')
    execaSync('git', ['add', '.'], { cwd: dir })
    execaSync('git', ['commit', '-m', 'test: add placeholder'], { cwd: dir })

    // Step 2: modify test + add impl (both are "modified" files now)
    writeFileSync(join(dir, 'src', 'foo.test.ts'), 'real test code')
    writeFileSync(join(dir, 'src', 'foo.ts'), 'impl code')
    execaSync('git', ['add', '.'], { cwd: dir })
    // The hook sees foo.test.ts (test) + foo.ts (impl) = VIOLATION
    const result = execaSync('git', ['commit', '-m', 'feat'], { cwd: dir, reject: false })
    expect(result.exitCode).toBe(1) // Caught: still blocked

    // But wait — what if the test file was already committed and only impl is new?
  })

  it('LOOPHOLE: modify existing test file + add impl file in same commit', () => {
    dir = setupRepo(getHookScript())

    mkdirSync(join(dir, 'src'), { recursive: true })

    // Commit real tests first
    writeFileSync(join(dir, 'src', 'foo.test.ts'), 'real strong tests')
    execaSync('git', ['add', '.'], { cwd: dir })
    execaSync('git', ['commit', '-m', 'test: add tests'], { cwd: dir })

    // Now weaken tests AND add impl in same commit
    writeFileSync(join(dir, 'src', 'foo.test.ts'), 'weakened tests')
    writeFileSync(join(dir, 'src', 'foo.ts'), 'impl fitted to weak tests')
    execaSync('git', ['add', '.'], { cwd: dir })
    const result = execaSync('git', ['commit', '-m', 'feat'], { cwd: dir, reject: false })
    // Hook blocks this: modified test + new impl = VIOLATION
    expect(result.exitCode).toBe(1) // Caught
  })

  // =========================================================================
  // ATTACK 5: Use git commit --no-verify
  // The nuclear option. Works on any pre-commit hook.
  // =========================================================================
  it('DESIGN FLAW: --no-verify bypasses all pre-commit hooks', () => {
    dir = setupRepo(getHookScript())

    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'foo.test.ts'), 'test code')
    writeFileSync(join(dir, 'src', 'foo.ts'), 'impl code')

    execaSync('git', ['add', '.'], { cwd: dir })
    const result = execaSync('git', ['commit', '--no-verify', '-m', 'yolo'], { cwd: dir, reject: false })
    expect(result.exitCode).toBe(0) // DESIGN FLAW: --no-verify skips everything
  })

  // =========================================================================
  // ATTACK 6: Config files are not protected
  // Strategy: Agent can modify vibecheck.config.ts alongside implementation
  // because config files don't match the test pattern.
  // =========================================================================
  it('LOOPHOLE: modifying config alongside impl is not blocked', () => {
    dir = setupRepo(getHookScript())

    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'foo.ts'), 'impl code')
    writeFileSync(join(dir, 'vibecheck.config.ts'), 'defineConfig({ mutation: { threshold: 0 } })')

    execaSync('git', ['add', '.'], { cwd: dir })
    const result = execaSync('git', ['commit', '-m', 'feat'], { cwd: dir, reject: false })
    expect(result.exitCode).toBe(0) // LOOPHOLE: config weakening + impl in one commit
  })
})
