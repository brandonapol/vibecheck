import { execa } from 'execa'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtractedTest, SetupStatement } from '../analyzers/test-ast.js'
import type { LanguageAdapter } from './types.js'

/** Matchers the Go helper emits. Lowercase names describe a guarded
 *  `t.Error`/`t.Fatal` condition; capitalized names are testify methods and
 *  rank like their Jest counterparts. */
export const GO_ASSERTION_STRENGTH: Record<string, number> = {
  equal: 10,
  deepEqual: 10,
  length: 8,
  bound: 7,
  errorIs: 7,
  contains: 6,
  noError: 6,
  predicate: 5,
  fail: 5,
  anyError: 4,
  notEqual: 4,
  truthy: 3,
  isNil: 3,
  notNil: 2,

  Exactly: 10,
  Same: 10,
  Equal: 9,
  JSONEq: 9,
  YAMLEq: 9,
  EqualValues: 8,
  ElementsMatch: 8,
  Len: 8,
  InDelta: 8,
  InEpsilon: 8,
  WithinDuration: 8,
  EqualError: 8,
  PanicsWithValue: 8,
  PanicsWithError: 8,
  Greater: 7,
  GreaterOrEqual: 7,
  Less: 7,
  LessOrEqual: 7,
  ErrorIs: 7,
  ErrorAs: 7,
  ErrorContains: 7,
  Contains: 6,
  NotContains: 6,
  Subset: 6,
  Regexp: 6,
  IsType: 6,
  NoError: 6,
  Positive: 5,
  Negative: 5,
  Implements: 5,
  Error: 4,
  Panics: 4,
  NotPanics: 4,
  NotEqual: 4,
  True: 3,
  False: 3,
  Nil: 3,
  Empty: 3,
  Zero: 3,
  Condition: 3,
  Eventually: 3,
  NotNil: 2,
  NotEmpty: 2,
  NotZero: 2,
}

// Helpers and custom checks are neutral, as unknown Jest matchers are.
const UNKNOWN_MATCHER_STRENGTH = 5

const HELPER_FILES = ['go.mod', 'main.go']

type GoExtraction = { tests: ExtractedTest[]; setup: SetupStatement[] }

export type GoAdapterOptions = {
  /** The `go` executable used to build the parser helper. */
  goBinary?: string
  /** Where built helpers are cached, keyed by a hash of their source. */
  cacheDir?: string
}

/** The helper's source ships in the package under helpers/go-testast. */
function helperDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const candidate = join(dir, 'helpers', 'go-testast')
    if (existsSync(join(candidate, 'go.mod'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) throw new Error('vibecheck: the Go test parser source (helpers/go-testast) is missing')
    dir = parent
  }
}

async function buildHelper(goBinary: string, cacheDir: string): Promise<string> {
  const dir = helperDir()
  const hash = createHash('sha256')
  for (const file of HELPER_FILES) hash.update(readFileSync(join(dir, file)))
  const binary = join(cacheDir, `go-testast-${hash.digest('hex').slice(0, 16)}${process.platform === 'win32' ? '.exe' : ''}`)
  if (existsSync(binary)) return binary

  mkdirSync(cacheDir, { recursive: true })
  const partial = `${binary}.${process.pid}`
  try {
    await execa(goBinary, ['build', '-o', partial, '.'], { cwd: dir })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Go toolchain not found ('${goBinary}'): install Go, or disable languages.go`)
    }
    throw new Error(`Could not build the Go test parser: ${(err as { stderr?: string }).stderr ?? (err as Error).message}`)
  }
  // Rename so a concurrent run never executes a half-written binary.
  renameSync(partial, binary)
  return binary
}

export function createGoAdapter({
  goBinary = 'go',
  cacheDir = join(tmpdir(), 'vibecheck'),
}: GoAdapterOptions = {}): LanguageAdapter {
  let helper: Promise<string> | undefined
  // extractTests and extractSetup on the same file share one helper run.
  const extractions = new Map<string, Promise<GoExtraction>>()

  function extract(source: string, path: string): Promise<GoExtraction> {
    const key = `${path}\0${source}`
    let pending = extractions.get(key)
    if (!pending) {
      pending = (async () => {
        helper ??= buildHelper(goBinary, cacheDir)
        try {
          const { stdout } = await execa(await helper, [], { input: source })
          return JSON.parse(stdout) as GoExtraction
        } catch (err) {
          const stderr = (err as { stderr?: string }).stderr
          throw new Error(`Could not parse ${path} as Go: ${stderr || (err as Error).message}`)
        }
      })()
      extractions.set(key, pending)
    }
    return pending
  }

  return {
    id: 'go',
    testPatterns: ['**/*_test.go'],
    sourcePatterns: ['**/*.go'],
    extractTests: async (source, path) => (await extract(source, path)).tests,
    extractSetup: async (source, path) => (await extract(source, path)).setup,
    assertionStrength: matcher => GO_ASSERTION_STRENGTH[matcher] ?? UNKNOWN_MATCHER_STRENGTH,
  }
}

/** Go tests parsed by a helper built from helpers/go-testast with the local
 *  Go toolchain. No mutation engine yet (#79). */
export const goAdapter = createGoAdapter()
