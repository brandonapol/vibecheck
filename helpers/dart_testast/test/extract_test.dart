import 'package:dart_testast/extract.dart';
import 'package:test/test.dart';

List<Map<String, Object?>> tests(Map<String, Object?> result) =>
    (result['tests'] as List).cast<Map<String, Object?>>();

Map<String, Object?> find(Map<String, Object?> result, String id) =>
    tests(result).firstWhere(
      (t) => t['id'] == id,
      orElse: () => throw StateError(
        'no test "$id"; have ${tests(result).map((t) => t['id']).toList()}',
      ),
    );

List<Map<String, Object?>> assertions(Map<String, Object?> test) =>
    (test['assertions'] as List).cast<Map<String, Object?>>();

List<String> matchers(Map<String, Object?> test) =>
    assertions(test).map((a) => a['matcher'] as String).toList();

void main() {
  test('rejects a file that does not parse', () {
    expect(() => extract('void main() { test( }'), throwsFormatException);
  });

  test('finds tests, widget tests, and groups with their paths', () {
    final result = extract('''
void main() {
  group('sum', () {
    test('adds', () { expect(sum(1, 2), 3); });
    group('nested', () {
      testWidgets('renders', (tester) async { expect(find.text('x'), findsOneWidget); });
    });
  });
  test('top', () {});
}
''');
    expect(tests(result).map((t) => t['id']).toList(), [
      'sum > adds',
      'sum > nested > renders',
      'top',
    ]);
    final renders = find(result, 'sum > nested > renders');
    expect(renders['name'], 'renders');
    expect(renders['describePath'], ['sum', 'nested']);
  });

  test('classifies matchers, treating a bare value as equals', () {
    final result = extract('''
void main() {
  test('kinds', () async {
    expect(a, 3);
    expect(a, equals(b));
    expect(a, isTrue);
    expect(a, hasLength(2));
    expect(a, isA<Foo>());
    expect(a, isNotNull);
    expect(a, isNotEmpty);
    expect(a, closeTo(1.0, 0.1));
    expect(a, expected);
    expect(a, isValidUser);
    expect(() => f(), throwsA(isA<FormatException>()));
    expect(() => f(), throwsA(anything));
    expect(() => f(), throwsException);
    expect(find.byType(X), findsWidgets);
    expect(find.byType(X), findsNWidgets(2));
    expect(find.byType(X), findsNothing);
    await expectLater(find.byType(X), matchesGoldenFile('x.png'));
    expect(a, isNot(equals(b)));
  });
}
''');
    expect(matchers(find(result, 'kinds')), [
      'equals',
      'equals',
      'isTrue',
      'hasLength',
      'isA',
      'isNotNull',
      'isNotEmpty',
      'closeTo',
      'equals',
      'isValidUser',
      'throwsA',
      'throwsAnything',
      'throwsException',
      'findsWidgets',
      'findsNWidgets',
      'findsNothing',
      'matchesGoldenFile',
      'isNot',
    ]);
  });

  test('marks which matchers carry an expected value', () {
    final a = assertions(
      find(
        extract(
          "void main() { test('t', () { expect(a, 3); expect(a, isNotNull); expect(a, hasLength(2)); }); }",
        ),
        't',
      ),
    );
    expect(a.map((x) => x['hasArguments']).toList(), [true, false, true]);
  });

  test('skip arguments and @Skip', () {
    final result = extract('''
void main() {
  test('reason', () {}, skip: 'flaky');
  test('flag', () {}, skip: true);
  test('off', () {}, skip: false);
  test('dynamic', () {}, skip: isBrowser);
  group('g', () { test('child', () {}); }, skip: true);
  testWidgets('w', (tester) async {}, skip: true);
}
''');
    expect(
      {for (final t in tests(result)) t['id']: t['skipped']},
      {
        'reason': true,
        'flag': true,
        'off': false,
        'dynamic': true,
        'g > child': true,
        'w': true,
      },
    );

    final skippedLibrary = extract('''
@Skip('later')
library;
void main() { test('t', () {}); }
''');
    expect(find(skippedLibrary, 't')['skipped'], true);
  });

  test('flags tautologies', () {
    final t = find(
      extract('''
void main() {
  test('t', () {
    expect(x, x);
    expect(true, isTrue);
    expect(1, equals(1));
    expect(x, anything);
    expect(f(), f());
    expect(x, 3);
  });
}
'''),
      't',
    );
    expect(assertions(t).map((a) => a['tautological']).toList(), [
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  test(
    'marks assertions behind branches, loops, and swallowing catches as conditional',
    () {
      final t = find(
        extract('''
void main() {
  test('t', () {
    expect(a, 1);
    if (ci) { expect(a, 2); }
    for (final c in cases) { expect(c, 3); }
    for (final c in [1, 2]) { expect(c, 4); }
    try { expect(a, 5); } catch (_) {}
    try { expect(a, 6); } catch (e) { rethrow; }
    items.forEach((i) { expect(i, 7); });
    flag ? expect(a, 8) : null;
  });
}
'''),
        't',
      );
      expect(assertions(t).map((a) => a['conditional']).toList(), [
        false,
        true,
        true,
        false,
        true,
        false,
        false,
        true,
      ]);
    },
  );

  test('keys ignore formatting, comments, trailing commas, and reasons', () {
    final a = find(
      extract('''
void main() {
  test('t', () {
    final v = sum(1, 2); // compute
    expect(v, equals(3), reason: 'first');
  });
}
'''),
      't',
    );
    final b = find(
      extract('''
void main() {
  test('t', () {
    final v = sum(
      1,
      2,
    );
    expect(
      v,
      equals(3),
      reason: 'reworded',
    );
  });
}
'''),
      't',
    );
    expect(a['bodyKey'], b['bodyKey']);
    expect(assertions(a).single['key'], assertions(b).single['key']);
  });

  test('the body key excludes assertions but not inputs', () {
    String key(String body) =>
        find(
              extract("void main() { test('t', () async { $body }); }"),
              't',
            )['bodyKey']
            as String;
    expect(
      key('final v = f(1); expect(v, 3);'),
      key('final v = f(1); expect(v, 4);'),
    );
    expect(
      key('final v = f(1); expect(v, 3);'),
      isNot(key('final v = f(2); expect(v, 3);')),
    );
    expect(
      key('await tester.pump(const Duration(seconds: 1)); expect(a, 1);'),
      isNot(key('await tester.pumpAndSettle(); expect(a, 1);')),
    );
  });

  test(
    'setup covers top-level declarations and non-test statements in main and groups',
    () {
      final result = extract('''
import 'package:test/test.dart';
const limit = 3;
int fixture() => 1;
void main() {
  late Foo foo;
  setUp(() { foo = Foo(); });
  group('g', () {
    tearDown(() {});
    test('t', () {});
  });
}
''');
      expect((result['setup'] as List).length, 5);
    },
  );
}
