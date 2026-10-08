import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultConfig } from '../config/schema.js'
import { parseMutationTestReport, runMutationTest } from './dart-mutation.js'
import type { MutationRunOptions } from './types.js'

vi.mock('execa', () => ({ execa: vi.fn() }))

import { execa } from 'execa'
import { readFile } from 'node:fs/promises'

const mockExeca = vi.mocked(execa)

const REPORT = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="add" tests="2" failures="0" errors="0">
    <testcase name="Line3_add_0" classname="lib/add.dart" time="0.1"/>
    <testcase name="Line3_add_1" classname="lib/add.dart" time="0.1"/>
  </testsuite>
  <testsuite name="eq" tests="1" failures="1" errors="0">
    <testcase name="Line4_eq_0" classname="lib/weak.dart" time="0.05">
      <failure type="undetected" message="All tests passed despite changing the code!">
File: lib/weak.dart
Line: 4
Original line: return n + 1;
Mutation: return n - 1;
      </failure>
    </testcase>
  </testsuite>
  <testsuite name="cmp" tests="2" failures="0" errors="2">
    <testcase name="Line8_cmp_0" classname="lib/add.dart" time="30">
      <error type="timeout" message="timed out">
File: lib/add.dart
Line: 8
Original line: return a + b;
Mutation: return a - b;
      </error>
    </testcase>
    <testcase name="Line9_cmp_0" classname="lib/covered.dart" time="0">
      <error type="not covered by tests" message="not covered">
File: lib/covered.dart
Line: 9
Original line: return a &amp;&amp; b;
Mutation: return a || b;
      </error>
    </testcase>
  </testsuite>
</testsuites>
`

function options(overrides: Partial<MutationRunOptions> = {}): MutationRunOptions {
  return {
    include: ['lib/**/*.dart'],
    exclude: [],
    protectedBranch: 'main',
    mutation: defaultConfig.mutation,
    ...overrides,
  }
}

describe('parseMutationTestReport', () => {
  it('counts a timeout as killed and an uncovered line against the score', () => {
    const report = parseMutationTestReport(REPORT)
    expect(report.killed).toBe(3)
    expect(report.total).toBe(5)
    expect(report.overallScore).toBe(60)
    expect(report.survivingMutants).toEqual([
      {
        file: 'lib/weak.dart',
        mutator: 'eq',
        location: { line: 4, column: 1 },
        replacement: 'return n - 1;',
      },
      {
        file: 'lib/covered.dart',
        mutator: 'cmp',
        location: { line: 9, column: 1 },
        replacement: 'return a || b;',
      },
    ])
  })

  it('scores a report with no test cases as nothing to mutate', () => {
    const report = parseMutationTestReport('<?xml version="1.0"?><testsuites></testsuites>')
    expect(report).toEqual({
      overallScore: 100,
      fileScores: {},
      survivingMutants: [],
      killed: 0,
      total: 0,
    })
  })

  it('drops test files and excluded sources', () => {
    const report = parseMutationTestReport(
      `<testsuites>
        <testsuite name="add">
          <testcase name="Line1_add_0" classname="lib/add.dart"/>
          <testcase name="Line1_add_0" classname="test/add_test.dart"/>
          <testcase name="Line1_add_0" classname="lib/skip.dart"/>
        </testsuite>
      </testsuites>`,
      { include: ['lib/**/*.dart'], exclude: ['lib/skip.dart'] },
    )
    expect(report.killed).toBe(1)
    expect(report.total).toBe(1)
    expect(report.fileScores).toEqual({ 'lib/add.dart': 100 })
  })

  it('refuses to score a report that is not xunit', () => {
    let message = ''
    try {
      parseMutationTestReport('{"files":[]}')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('unparsable')
  })

  it('refuses to score an unknown testcase result', () => {
    let message = ''
    try {
      parseMutationTestReport(
        `<testsuites><testsuite name="add"><testcase name="Line1_add_0" classname="lib/add.dart"><error type="blocked" message="no"/></testcase></testsuite></testsuites>`,
      )
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('blocked')
  })
})

describe('runMutationTest', () => {
  let binDir: string
  let cwd: string

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), 'vibecheck-dart-bin-'))
    cwd = mkdtempSync(join(tmpdir(), 'vibecheck-dart-cwd-'))
    writeFileSync(join(binDir, 'dart'), '#!/bin/sh\nexit 0\n')
    chmodSync(join(binDir, 'dart'), 0o755)
    mkdirSync(join(cwd, 'lib'))
    mkdirSync(join(cwd, 'test'))
    writeFileSync(join(cwd, 'lib/add.dart'), 'int add(int a, int b) => a + b;\n')
    writeFileSync(join(cwd, 'lib/weak.dart'), 'int weak(int n) => n + 1;\n')
    writeFileSync(join(cwd, 'lib/skip.dart'), 'int skip(int n) => n;\n')
    writeFileSync(join(cwd, 'test/add_test.dart'), 'void main() {}\n')
    mockExeca.mockReset()
  })

  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  })

  function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return { PATH: binDir, ...extra }
  }

  it('throws when dart is not on PATH and does not run mutation_test', async () => {
    let message = ''
    try {
      await runMutationTest(options(), cwd, { PATH: cwd })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('Dart SDK')
    expect(mockExeca).not.toHaveBeenCalled()
  })

  it('runs mutation_test on lib sources with vibecheck rules and no tool threshold', async () => {
    let rules = ''
    let input = ''
    mockExeca.mockImplementation(async (_bin, args) => {
      const list = args as string[]
      rules = await readFile(list[list.indexOf('--rules') + 1], 'utf8')
      input = await readFile(list[list.length - 1], 'utf8')
      const out = list[list.indexOf('-o') + 1]
      await import('node:fs/promises').then(fs =>
        fs.writeFile(join(out, 'mutation-test.xunit.xml'), REPORT),
      )
      return { exitCode: 0 } as never
    })

    const report = await runMutationTest(options({ exclude: ['lib/skip.dart'] }), cwd, env())

    expect(report.overallScore).toBe(60)
    expect(rules).toContain('id="add"')
    expect(rules).toContain('id="eq"')
    expect(rules).toContain('id="and"')
    expect(rules).toContain('id="return-int"')
    expect(rules).not.toContain('return null')
    expect(input).toContain('lib/add.dart')
    expect(input).toContain('lib/weak.dart')
    expect(input).not.toContain('add_test.dart')
    expect(input).not.toContain('lib/skip.dart')
    expect(input).toContain('failure="0"')
    expect(input).toContain('dart test')
  })

  it('scores a report when mutation_test exits non-zero', async () => {
    mockExeca.mockImplementation(async (_bin, args) => {
      const list = args as string[]
      const out = list[list.indexOf('-o') + 1]
      await import('node:fs/promises').then(fs =>
        fs.writeFile(
          join(out, 'mutation-test.xunit.xml'),
          '<testsuites><testsuite name="add"><testcase name="Line1_add_0" classname="lib/add.dart"/></testsuite></testsuites>',
        ),
      )
      return { exitCode: 1, stderr: 'threshold' } as never
    })
    const report = await runMutationTest(options(), cwd, env())
    expect(report.overallScore).toBe(100)
    expect(report.killed).toBe(1)
  })

  it('refuses to score a failed run that wrote no report', async () => {
    mockExeca.mockResolvedValue({ exitCode: 1, stderr: 'build failed' } as never)
    let message = ''
    try {
      await runMutationTest(options(), cwd, env())
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('not a mutation score')
    expect(message).toContain('build failed')
  })

  it('in CI mutates only changed Dart sources and marks the report diff-scoped', async () => {
    let input = ''
    mockExeca.mockImplementation(async (bin, args) => {
      const list = args as string[]
      if (bin === 'git') return { stdout: 'lib/weak.dart\nREADME.md\n', exitCode: 0 } as never
      input = await readFile(list[list.length - 1], 'utf8')
      const out = list[list.indexOf('-o') + 1]
      await import('node:fs/promises').then(fs =>
        fs.writeFile(
          join(out, 'mutation-test.xunit.xml'),
          '<testsuites><testsuite name="add"><testcase name="Line1_add_0" classname="lib/weak.dart"><failure type="undetected" message="lived">Line: 1\nMutation: return n - 1;</failure></testcase></testsuite></testsuites>',
        ),
      )
      return { exitCode: 0 } as never
    })

    const report = await runMutationTest(options(), cwd, env({ CI: 'true', GITHUB_BASE_REF: 'feature' }))

    expect(report.diffScoped).toBe(true)
    expect(report.overallScore).toBe(0)
    expect(input).toContain('lib/weak.dart')
    expect(input).not.toContain('lib/add.dart')
    expect(mockExeca).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', '--no-renames', 'origin/feature', 'HEAD'],
    )
  })

  it('in CI scores 100 without running mutation_test when no Dart source changed', async () => {
    mockExeca.mockResolvedValue({ stdout: 'README.md\n', exitCode: 0 } as never)
    const report = await runMutationTest(options(), cwd, env({ CI: 'true' }))
    expect(report).toEqual({
      overallScore: 100,
      fileScores: {},
      survivingMutants: [],
      killed: 0,
      total: 0,
      diffScoped: true,
    })
    expect(mockExeca).toHaveBeenCalledTimes(1)
    expect(mockExeca).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', '--no-renames', 'origin/main', 'HEAD'],
    )
  })
})
