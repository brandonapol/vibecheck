import { execa } from 'execa'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHelperExtractor, type HelperSpec } from './helper.js'
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

const GO_HELPER: HelperSpec = {
  dir: 'go-testast',
  sources: ['go.mod', 'main.go'],
  toolchainName: 'Go toolchain',
  languageKey: 'go',
  build: async (go, sourceDir, output) => {
    await execa(go, ['build', '-o', output, '.'], { cwd: sourceDir })
  },
}

export type GoAdapterOptions = {
  /** The `go` executable used to build the parser helper. */
  goBinary?: string
  /** Where built helpers are cached, keyed by a hash of their source. */
  cacheDir?: string
}

export function createGoAdapter({
  goBinary = 'go',
  cacheDir = join(tmpdir(), 'vibecheck'),
}: GoAdapterOptions = {}): LanguageAdapter {
  const extract = createHelperExtractor(GO_HELPER, { toolchain: goBinary, cacheDir })
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
