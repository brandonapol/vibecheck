import { execa } from 'execa'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHelperExtractor, type HelperSpec } from './helper.js'
import { runMutationTest } from './mutation-test.js'
import type { LanguageAdapter } from './types.js'

/** `package:matcher` and `flutter_test` matchers on the shared scale. A bare
 *  value in `expect(actual, 3)` is reported as `equals`. */
export const DART_ASSERTION_STRENGTH: Record<string, number> = {
  equals: 10,
  same: 10,
  isTrue: 10,
  isFalse: 10,
  orderedEquals: 10,
  findsOneWidget: 10,
  findsOne: 10,
  findsNWidgets: 10,
  findsExactly: 10,
  unorderedEquals: 9,
  equalsIgnoringCase: 9,
  equalsIgnoringWhitespace: 9,
  isZero: 9,
  findsNothing: 9,
  matchesGoldenFile: 9,
  hasLength: 8,
  closeTo: 8,
  containsAllInOrder: 8,
  greaterThan: 7,
  greaterThanOrEqualTo: 7,
  lessThan: 7,
  lessThanOrEqualTo: 7,
  inInclusiveRange: 7,
  inExclusiveRange: 7,
  inClosedOpenRange: 7,
  inOpenClosedRange: 7,
  containsAll: 7,
  containsPair: 7,
  isEmpty: 7,
  throwsA: 7,
  findsAtLeastNWidgets: 7,
  findsAtLeast: 7,
  having: 7,
  contains: 6,
  startsWith: 6,
  endsWith: 6,
  matches: 6,
  stringContainsInOrder: 6,
  isA: 6,
  TypeMatcher: 6,
  isIn: 6,
  everyElement: 6,
  anyElement: 5,
  emits: 6,
  emitsInOrder: 7,
  throwsArgumentError: 6,
  throwsStateError: 6,
  throwsFormatException: 6,
  throwsUnsupportedError: 6,
  throwsUnimplementedError: 6,
  throwsRangeError: 6,
  throwsNoSuchMethodError: 6,
  throwsConcurrentModificationError: 6,
  throwsCyclicInitializationError: 6,
  throwsFlutterError: 6,
  throwsAssertionError: 6,
  predicate: 5,
  allOf: 5,
  isPositive: 5,
  isNegative: 5,
  isNonPositive: 5,
  isNonNegative: 5,
  isNonZero: 4,
  isNot: 4,
  anyOf: 4,
  throwsException: 4,
  throws: 4,
  emitsError: 4,
  throwsAnything: 3,
  isNull: 3,
  isNaN: 3,
  isNotNaN: 3,
  isList: 3,
  isMap: 3,
  returnsNormally: 3,
  completes: 3,
  findsWidgets: 3,
  isNotNull: 2,
  isNotEmpty: 2,
  findsAny: 2,
  anything: 0,
}

// Custom matchers are neutral, as unknown Jest matchers are.
const UNKNOWN_MATCHER_STRENGTH = 5

const HELPER_SOURCES = ['pubspec.yaml', 'lib/extract.dart', 'bin/dart_testast.dart']

const DART_HELPER: HelperSpec = {
  dir: 'dart_testast',
  sources: HELPER_SOURCES,
  toolchainName: 'Dart SDK',
  languageKey: 'dart',
  // Built in a scratch copy so an installed package stays read-only. Dev
  // dependencies (package:test, for the helper's own tests) are dropped, so
  // the build fetches only package:analyzer.
  build: async (dart, sourceDir, output) => {
    const work = mkdtempSync(join(tmpdir(), 'vibecheck-dart-build-'))
    try {
      for (const file of HELPER_SOURCES) cpSync(join(sourceDir, file), join(work, file), { recursive: true })
      const pubspec = readFileSync(join(work, 'pubspec.yaml'), 'utf-8')
      writeFileSync(join(work, 'pubspec.yaml'), pubspec.replace(/\ndev_dependencies:[\s\S]*$/, '\n'))
      await execa(dart, ['pub', 'get'], { cwd: work })
      await execa(dart, ['compile', 'exe', 'bin/dart_testast.dart', '-o', output], { cwd: work })
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  },
}

export type DartAdapterOptions = {
  /** The `dart` executable used to build the parser helper. Flutter's works. */
  dartBinary?: string
  /** Where built helpers are cached, keyed by a hash of their source. */
  cacheDir?: string
}

export function createDartAdapter({
  dartBinary = 'dart',
  cacheDir = join(tmpdir(), 'vibecheck'),
}: DartAdapterOptions = {}): LanguageAdapter {
  const extract = createHelperExtractor(DART_HELPER, { toolchain: dartBinary, cacheDir })
  return {
    id: 'dart',
    testPatterns: ['**/*_test.dart'],
    sourcePatterns: ['lib/**/*.dart'],
    extractTests: async (source, path) => (await extract(source, path)).tests,
    extractSetup: async (source, path) => (await extract(source, path)).setup,
    assertionStrength: matcher => DART_ASSERTION_STRENGTH[matcher] ?? UNKNOWN_MATCHER_STRENGTH,
    runMutation: options => runMutationTest(options),
  }
}

/** Dart and Flutter tests parsed by a helper built from helpers/dart_testast
 *  with the local Dart SDK. Mutation testing runs mutation_test 1.8.1. */
export const dartAdapter = createDartAdapter()
