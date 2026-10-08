import { describe, it, expect } from 'vitest'
import {
  detectGoldenUpdates,
  extraGoldenTestFiles,
  resolveRelatedFile,
  type GoldenSide,
} from './golden-diff.js'

function side(overrides: Partial<GoldenSide> = {}): GoldenSide {
  return {
    id: 'counter > renders',
    assertionKeys: ['expect(find.byType(Counter)|matchesGoldenFile(goldens/counter.png))'],
    bodyKey: 'pump',
    relatedFiles: ['test/goldens/counter.png'],
    ...overrides,
  }
}

describe('resolveRelatedFile', () => {
  it('resolves a golden relative to the test file', () => {
    expect(resolveRelatedFile('test/widget_test.dart', 'goldens/x.png')).toBe('test/goldens/x.png')
  })

  it('normalizes a parent segment', () => {
    expect(resolveRelatedFile('test/widget_test.dart', '../goldens/x.png')).toBe('goldens/x.png')
  })
})

describe('extraGoldenTestFiles', () => {
  it('returns unchanged tests only when an image changed', () => {
    expect(extraGoldenTestFiles(
      ['lib/counter.dart', 'test/goldens/counter.png'],
      ['test/widget_test.dart', 'test/other_test.dart'],
    )).toEqual(['test/widget_test.dart', 'test/other_test.dart'])
  })

  it('ignores tests that are already in the diff, and diffs with no image', () => {
    expect(extraGoldenTestFiles(
      ['test/widget_test.dart', 'test/goldens/counter.png'],
      ['test/widget_test.dart'],
    )).toEqual([])
    expect(extraGoldenTestFiles(['lib/counter.dart'], ['test/widget_test.dart'])).toEqual([])
  })
})

describe('detectGoldenUpdates', () => {
  const changed = ['lib/counter.dart', 'test/goldens/counter.png']

  it('reports a golden updated alongside the widget it covers', () => {
    const violations = detectGoldenUpdates({
      file: 'test/widget_test.dart',
      before: [side()],
      after: [side()],
      changedFiles: changed,
    })
    expect(violations.map(v => v.pattern)).toEqual(['golden-updated'])
    expect(violations[0].detail).toContain('test/goldens/counter.png')
  })

  it('reports a golden updated while the test itself did not change', () => {
    const violations = detectGoldenUpdates({
      file: 'test/widget_test.dart',
      before: [side()],
      after: [side()],
      changedFiles: ['test/goldens/counter.png'],
    })
    expect(violations.map(v => v.pattern)).toEqual(['golden-updated'])
  })

  it('does not report a golden added for a new test', () => {
    const violations = detectGoldenUpdates({
      file: 'test/widget_test.dart',
      before: [],
      after: [side({ id: 'counter > new', relatedFiles: ['test/goldens/new.png'] })],
      changedFiles: ['lib/counter.dart', 'test/goldens/new.png', 'test/widget_test.dart'],
    })
    expect(violations).toEqual([])
  })

  it('reports an existing test retargeted at a different golden file', () => {
    const violations = detectGoldenUpdates({
      file: 'test/widget_test.dart',
      before: [side()],
      after: [side({ relatedFiles: ['test/goldens/counter_v2.png'] })],
      changedFiles: ['test/widget_test.dart', 'test/goldens/counter_v2.png'],
    })
    expect(violations.map(v => v.pattern)).toEqual(['golden-updated'])
    expect(violations[0].detail).toContain('counter_v2.png')
  })

  it('does not report a golden whose pixels did not change', () => {
    const violations = detectGoldenUpdates({
      file: 'test/widget_test.dart',
      before: [side()],
      after: [side()],
      changedFiles: ['lib/counter.dart'],
    })
    expect(violations).toEqual([])
  })
})
