import { describe, it, expect } from 'vitest'
import { execaSync } from 'execa'
import { detectWeakeningWithAdapter, type WeakeningPattern } from '../../src/analyzers/semantic-diff.js'
import { dartAdapter } from '../../src/languages/dart.js'

/**
 * ADVERSARIAL TESTS: ways an agent weakens a Dart or Flutter test without
 * deleting the file. Each case is a base version and a weakened version of
 * the same `_test.dart`; every one must be reported.
 */

const hasDart = (() => {
  try {
    execaSync('dart', ['--version'])
    return true
  } catch {
    return false
  }
})()

const file = 'test/widgets/counter_test.dart'

function dartFile(body: string): string {
  return `import 'package:flutter_test/flutter_test.dart';\n\nvoid main() {\n${body}\n}\n`
}

async function patterns(before: string, after: string): Promise<WeakeningPattern[]> {
  const violations = await detectWeakeningWithAdapter(dartFile(before), dartFile(after), file, dartAdapter)
  return violations.map(v => v.pattern)
}

const widget = (assertion: string, pump = 'await tester.pump();') => `  testWidgets('shows the count', (tester) async {
    await tester.pumpWidget(const Counter());
    ${pump}
    ${assertion}
  });`

describe.skipIf(!hasDart)('Dart semantic diff evasion attacks (requires dart)', () => {
  it('catches findsOneWidget loosened to findsWidgets', async () => {
    expect(
      await patterns(widget("expect(find.text('1'), findsOneWidget);"), widget("expect(find.text('1'), findsWidgets);")),
    ).toContain('precision-reduction')
  })

  it('catches findsWidgets loosened to findsAny', async () => {
    expect(
      await patterns(widget("expect(find.text('1'), findsWidgets);"), widget("expect(find.text('1'), findsAny);")),
    ).toContain('precision-reduction')
  })

  it('catches a findsNothing check being deleted', async () => {
    const before = widget("expect(find.text('1'), findsOneWidget);\n    expect(find.text('0'), findsNothing);")
    const after = widget("expect(find.text('1'), findsOneWidget);")
    expect(await patterns(before, after)).toContain('assertion-count-reduction')
  })

  it('catches pump(duration) being replaced by pumpAndSettle', async () => {
    const before = widget("expect(find.text('1'), findsOneWidget);", 'await tester.pump(const Duration(milliseconds: 100));')
    const after = widget("expect(find.text('1'), findsOneWidget);", 'await tester.pumpAndSettle();')
    expect(await patterns(before, after)).toContain('test-body-changed')
  })

  it('catches skip being added to testWidgets', async () => {
    const before = widget("expect(find.text('1'), findsOneWidget);")
    const after = before.replace('  });', '  }, skip: true);')
    expect(await patterns(before, after)).toContain('skip-addition')
  })

  it('catches skip being added to a group', async () => {
    const before = `  group('counter', () {\n${widget("expect(find.text('1'), findsOneWidget);")}\n  });`
    const after = before.replace(/\}\);$/, "}, skip: 'later');")
    expect(await patterns(before, after)).toContain('skip-addition')
  })

  it('catches a group being emptied out', async () => {
    const before = `  group('counter', () {\n${widget("expect(find.text('1'), findsOneWidget);")}\n  });`
    const after = `  group('counter', () {});`
    expect(await patterns(before, after)).toContain('test-deletion')
  })

  it('catches equals being weakened to isNotNull', async () => {
    const before = "  test('parses', () {\n    expect(parse('1'), equals(1));\n  });"
    const after = "  test('parses', () {\n    expect(parse('1'), isNotNull);\n  });"
    expect(await patterns(before, after)).toContain('precision-reduction')
  })

  it('catches a specific throwsA being relaxed to throwsA(anything)', async () => {
    const before = "  test('rejects', () {\n    expect(() => parse('x'), throwsA(isA<FormatException>()));\n  });"
    const after = "  test('rejects', () {\n    expect(() => parse('x'), throwsA(anything));\n  });"
    expect(await patterns(before, after)).toContain('precision-reduction')
  })

  it("catches a bound's tolerance being changed", async () => {
    const before = "  test('area', () {\n    expect(area(2), closeTo(12.56, 0.01));\n  });"
    const after = "  test('area', () {\n    expect(area(2), closeTo(12.56, 5));\n  });"
    expect(await patterns(before, after)).toContain('assertion-changed')
  })

  it('catches an expected value being changed', async () => {
    const before = "  test('adds', () {\n    expect(sum(1, 2), 3);\n  });"
    const after = "  test('adds', () {\n    expect(sum(1, 2), 4);\n  });"
    expect(await patterns(before, after)).toContain('assertion-changed')
  })

  it('catches an assertion moved behind a branch', async () => {
    const before = "  test('adds', () {\n    expect(sum(1, 2), 3);\n  });"
    const after = "  test('adds', () {\n    if (isCi) {\n      expect(sum(1, 2), 3);\n    }\n  });"
    expect(await patterns(before, after)).toContain('assertion-neutralized')
  })

  it('catches a self-comparison', async () => {
    const before = "  test('adds', () {\n    final v = sum(1, 2);\n    expect(v, 3);\n  });"
    const after = "  test('adds', () {\n    final v = sum(1, 2);\n    expect(v, v);\n  });"
    expect(await patterns(before, after)).toContain('tautological-assertion')
  })

  it('catches a new test that only checks isNotNull', async () => {
    const after = "  test('loads', () {\n    expect(load(), isNotNull);\n  });"
    expect(await patterns('', after)).toContain('weak-new-test')
  })

  it('reports nothing when the file is only reformatted', async () => {
    const before = "  test('adds', () { expect(sum(1, 2), equals(3)); });"
    const after = "  test('adds', () {\n    expect(\n      sum(1, 2),\n      equals(3),\n    );\n  });"
    expect(await patterns(before, after)).toEqual([])
  })

  it('reports nothing when a reason is reworded', async () => {
    const before = "  test('adds', () {\n    expect(sum(1, 2), 3, reason: 'sum');\n  });"
    const after = "  test('adds', () {\n    expect(sum(1, 2), 3, reason: 'one plus two');\n  });"
    expect(await patterns(before, after)).toEqual([])
  })

  it('reports nothing when a test is added', async () => {
    const before = "  test('adds', () {\n    expect(sum(1, 2), 3);\n  });"
    const after = `${before}\n  test('adds zero', () {\n    expect(sum(1, 0), 1);\n  });`
    expect(await patterns(before, after)).toEqual([])
  })
}, 180_000)
