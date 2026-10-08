import { describe, it, expect } from 'vitest'
import { execaSync } from 'execa'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDartAdapter, dartAdapter, DART_ASSERTION_STRENGTH } from './dart.js'
import { getAdapter } from './registry.js'

const hasDart = (() => {
  try {
    execaSync('dart', ['--version'])
    return true
  } catch {
    return false
  }
})()

const SOURCE = `import 'package:test/test.dart';

void main() {
  test('adds', () {
    expect(sum(1, 2), 3);
  });
}
`

describe('dartAdapter', () => {
  it('is registered as dart', () => {
    expect(getAdapter('dart')).toBe(dartAdapter)
  })

  it('defaults to Dart test files and lib sources', () => {
    expect(dartAdapter.testPatterns).toEqual(['**/*_test.dart'])
    expect(dartAdapter.sourcePatterns).toEqual(['lib/**/*.dart'])
  })

  it('ranks matchers on the shared scale', () => {
    expect(dartAdapter.assertionStrength('equals')).toBe(10)
    expect(dartAdapter.assertionStrength('findsOneWidget')).toBe(10)
    expect(dartAdapter.assertionStrength('hasLength')).toBe(8)
    expect(dartAdapter.assertionStrength('throwsA')).toBe(7)
    expect(dartAdapter.assertionStrength('isA')).toBe(6)
    expect(dartAdapter.assertionStrength('findsWidgets')).toBe(3)
    expect(dartAdapter.assertionStrength('isNotNull')).toBe(2)
    expect(dartAdapter.assertionStrength('findsAny')).toBe(2)
    expect(dartAdapter.assertionStrength('having')).toBe(7)
  })

  it('ranks finders from exact to loose', () => {
    const s = DART_ASSERTION_STRENGTH
    expect(s.findsOneWidget).toBeGreaterThan(s.findsAtLeastNWidgets)
    expect(s.findsAtLeastNWidgets).toBeGreaterThan(s.findsWidgets)
    expect(s.findsWidgets).toBeGreaterThan(s.findsAny)
  })

  it('treats a custom matcher as neutral', () => {
    expect(dartAdapter.assertionStrength('isValidUser')).toBe(5)
  })

  it('has no mutation engine yet', () => {
    expect(dartAdapter.runMutation).toBeTypeOf('function')
  })
})

describe.skipIf(!hasDart)('dartAdapter extraction (requires dart)', () => {
  it('extracts tests through the helper', async () => {
    const tests = await dartAdapter.extractTests(SOURCE, 'test/sum_test.dart')
    expect(tests.map(t => t.id)).toEqual(['adds'])
    expect(tests[0].assertions.map(a => a.matcher)).toEqual(['equals'])
  })

  it('extracts setup through the helper', async () => {
    expect(await dartAdapter.extractSetup(SOURCE, 'test/sum_test.dart')).toEqual([])
  })

  it('fails closed on a file that does not parse', async () => {
    await expect(dartAdapter.extractTests('void main() { test( }', 'test/bad_test.dart')).rejects.toThrow(
      /bad_test\.dart/,
    )
  })
}, 180_000)

describe('dartAdapter without a Dart SDK', () => {
  it('fails closed with a message naming the missing tool', async () => {
    const adapter = createDartAdapter({
      dartBinary: 'dart-does-not-exist-vibecheck',
      cacheDir: mkdtempSync(join(tmpdir(), 'vibecheck-nodart-')),
    })
    await expect(adapter.extractTests(SOURCE, 'test/sum_test.dart')).rejects.toThrow(/Dart SDK/)
  })
})
