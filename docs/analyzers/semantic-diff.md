# Semantic Diff Analysis

The semantic diff analyzer detects assertion weakening between commits. When an agent modifies a test file, vibecheck compares the before and after versions to catch subtle quality reductions.

## How It Works

1. Parse the before and after versions of the file into a real AST (`@babel/parser`, TypeScript + JSX)
2. Extract every test — including `it.each`, `test.concurrent`, `xit`, and `it.todo` variants — with its full `describe` path, skip state, and assertion chains
3. Match tests across versions by describe-path-qualified identity, falling back to bare-name matching so moving a test between `describe` blocks doesn't read as a deletion
4. Compare the **sorted multiset** of assertion strengths rank by rank: reordering assertions is not weakening, and padding with weak assertions cannot hide a removed strong one
5. Anything the AST cannot statically resolve — like `expect(x)[method]()` — fails closed as a `suspicious-assertion` violation

Deleting a whole test file reports `test-deletion` for every test that was in it. The empty side is not sent to the language parser: Go and Dart reject an empty file, and that error would hide the deletion. A file that does not exist on the base ref is not compared.

## Go

Go test files (`*_test.go`) are parsed by a small helper written in Go (`helpers/go-testast`, built with `go/ast`). It's compiled with your Go toolchain on first use and cached in the OS temp directory, keyed by a hash of its source. If Go is missing or a file doesn't parse, the check fails rather than passing.

**Tests**: `func TestXxx(t *testing.T)`, every `t.Run` subtest (with IDs like `TestSum/adds`), and every row of a table-driven test whose subtest name is a string literal in the table (`t.Run(tc.name, …)` over a slice of structs, or `t.Run(name, …)` over a map). Rows are compared one by one, so deleting a row is a `test-deletion` and changing a row's values is a `test-body-changed`. A table whose names can't be resolved statically is walked as ordinary code, and its loop counts as conditional.

**Assertions** come in three forms:

- A `t.Error*`/`t.Fatal*`/`t.Fail*` call guarded by an `if` (or a tagless `switch` case). The condition is the assertion, and its shape decides the matcher.
- A testify call (`assert.X(t, …)` / `require.X(t, …)`), with its `…f` variant folded into the base name and trailing message arguments left out of the key.
- A call that passes the test's `*testing.T` to a helper, named after the helper and ranked neutral (5).

| Strength | Go guard conditions | testify |
|----------|---------------------|---------|
| 10 | `got != want` (`equal`), `!reflect.DeepEqual`, `!cmp.Equal`, `cmp.Diff(…) != ""` (`deepEqual`) | `Exactly`, `Same` |
| 9 | | `Equal`, `JSONEq`, `YAMLEq` |
| 8 | `len(x) != n` (`length`) | `EqualValues`, `ElementsMatch`, `Len`, `InDelta`, `EqualError`, … |
| 7 | `<`, `>`, `<=`, `>=` (`bound`), `!errors.Is` / `errors.As` (`errorIs`) | `Greater…`, `Less…`, `ErrorIs`, `ErrorAs`, `ErrorContains` |
| 6 | `!strings.Contains` and friends (`contains`), fail when `err != nil` (`noError`) | `Contains`, `Subset`, `Regexp`, `IsType`, `NoError` |
| 5 | any other call (`predicate`), helpers | `Positive`, `Implements` |
| 4 | fail when `err == nil` (`anyError`), fail when two values are equal (`notEqual`), e.g. `if got == 0` | `Error`, `Panics`, `NotEqual` |
| 3 | `!ok` (`truthy`), fail when `x != nil` (`isNil`) | `True`, `False`, `Nil`, `Empty`, `Zero` |
| 2 | fail when `x == nil` (`notNil`) | `NotNil`, `NotEmpty`, `NotZero` |

**Skips**: a `t.Skip`, `t.Skipf`, or `t.SkipNow` anywhere in a test, guarded or not (including `if testing.Short()`), marks it and its subtests skipped.

**Conditional**: an assertion is conditional when something other than its own guard sits between it and the test: another `if`, a classic `for`, a `range` over anything but a non-empty literal or expanded table, or a `switch`/`select` case.

**Tautologies**: comparing an expression to itself, comparing two literals, a bare `true`/`false` guard, `assert.Equal(t, x, x)`, `assert.True(t, true)`.

Keys ignore formatting, comments, and failure messages, so `gofmt` and rewording a `t.Errorf` message never report anything.

## Dart and Flutter

Dart test files (`*_test.dart`) are parsed by a helper written in Dart (`helpers/dart_testast`, built on `package:analyzer`). On first use it's compiled with your Dart SDK (Flutter's `dart` works too): a scratch copy runs `dart pub get`, which needs network access once, then `dart compile exe`. The binary is cached in the OS temp directory, keyed by a hash of the helper's source. If the SDK is missing or a file doesn't parse, the check fails rather than passing.

**Tests**: `test`, `testWidgets`, and `group` calls reachable from `main`, including ones registered inside loops, with IDs like `counter > shows the count`. A `skip:` argument skips a test or a whole group unless it's literally `false` or `null`, so `skip: isBrowser` counts as skipped. `@Skip()` on the library skips everything.

**Assertions**: `expect` and `expectLater`. The matcher argument decides the name. A bare value (`expect(x, 3)`, `expect(x, expected)`) is `equals`. A bare identifier shaped like a matcher (`isValidUser`, `hasTitle`) is treated as a custom matcher and ranked neutral (5). `throwsA(anything)` is reported as `throwsAnything`.

| Strength | Matchers |
|----------|----------|
| 10 | values and `equals`, `same`, `isTrue`, `isFalse`, `orderedEquals`, `findsOneWidget`, `findsNWidgets`, `findsExactly` |
| 9 | `unorderedEquals`, `equalsIgnoringCase`, `isZero`, `findsNothing`, `matchesGoldenFile` |
| 8 | `hasLength`, `closeTo`, `containsAllInOrder` |
| 7 | `greaterThan` and friends, ranges, `containsAll`, `isEmpty`, `throwsA(<specific>)`, `findsAtLeastNWidgets`, `emitsInOrder` |
| 6 | `contains`, `startsWith`, `matches`, `isA`, `TypeMatcher`, `throwsStateError` and the other specific `throws…` |
| 5 | `predicate`, `allOf`, `isPositive`, custom matchers |
| 4 | `isNot`, `anyOf`, `throwsException`, `throws` |
| 3 | `throwsA(anything)`, `isNull`, `returnsNormally`, `completes`, `findsWidgets` |
| 2 | `isNotNull`, `isNotEmpty`, `findsAny` |
| 0 | `anything` (always tautological) |

**Flutter weakening** falls out of the same comparison. Loosening a finder (`findsOneWidget` → `findsWidgets` → `findsAny`) is a `precision-reduction`. Deleting a `findsNothing` check is an `assertion-count-reduction`. Swapping `pump(duration)` for `pumpAndSettle()` changes the test body, so it's a `test-body-changed`.

**Golden files.** `matchesGoldenFile('goldens/x.png')` is an expected value stored next to the test. The helper records string-literal paths; vibecheck resolves them relative to the test file. `golden-updated` fires when an existing test still pins an image whose bytes changed in this diff. Changing the test body or adding an assertion does not clear that. It also fires when an existing test is retargeted from one golden path to another. A golden added only by a new test is not a violation. A path that is not a string literal (`matchesGoldenFile(name)`) is not tracked.

**Conditional**: inside an `if`, a ternary, the right side of `&&`/`||`/`??`, a `for` over anything but a non-empty list literal, a `while`, a `switch` case, or a `try` whose `catch` doesn't rethrow. Callbacks (`forEach`, `then`) aren't conditional.

**Setup**: top-level declarations other than `main`, and every statement in `main` or a group body that isn't a test or group (`setUp`, `tearDown`, `late` variables).

Keys are built from tokens, so formatting, comments, trailing commas, and `reason:` text never report anything.

## Assertion Strength Rankings

Every assertion method has a strength score. Higher is more precise:

| Strength | Methods |
|----------|---------|
| 10 | `toBe`, `toStrictEqual` |
| 9 | `toEqual` |
| 8 | `toHaveLength`, `toHaveBeenCalledWith`, `toHaveBeenLastCalledWith`, `toHaveBeenNthCalledWith`, `toHaveReturnedWith`, `toBeCloseTo` |
| 7 | `toMatchObject`, `toContainEqual`, `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeLessThan`, `toBeLessThanOrEqual`, `toHaveBeenCalledTimes`, `toHaveReturnedTimes`, `toThrowError` |
| 6 | `toContain`, `toBeInstanceOf`, `toMatch`, `toHaveProperty` |
| 5 | `toMatchInlineSnapshot` |
| 4 | `toMatchSnapshot`, `toHaveBeenCalled`, `toHaveReturned`, `toThrow` |
| 3 | `toBeTruthy`, `toBeFalsy`, `toBeNull`, `toBeNaN` |
| 2 | `toBeDefined`, `toBeUndefined` |

A change from `toEqual` (9) to `toBeDefined` (2) is flagged as precision reduction. A change from `toBeDefined` (2) to `toEqual` (9) is allowed — that's strengthening.

Custom matchers not in the table score a neutral 5: swapping one custom matcher for another is not flagged, but replacing `toStrictEqual` (10) with an unknown matcher is.

## Detection Patterns

### Precision Reduction

Replacing a strong assertion with a weaker one:

```typescript
// Before
expect(getUser(1)).toEqual({ id: 1, name: 'Alice' })
// After — FLAGGED
expect(getUser(1)).toBeDefined()
```

### Test Deletion

Removing a test block entirely:

```typescript
// Before
it('handles edge case', () => { ... })
it('handles normal case', () => { ... })
// After — "handles edge case" FLAGGED as deleted
it('handles normal case', () => { ... })
```

### Skip Addition

Disabling a test in any form — `.skip`, `xit`/`xtest`, `.todo`, wrapping in `describe.skip`/`xdescribe`, or conditional `.skipIf(...)`/`.runIf(...)` (treated as skipped, fail closed):

```typescript
// Before
it('validates input', () => { ... })
// After — all FLAGGED
it.skip('validates input', () => { ... })
xit('validates input', () => { ... })
it.skipIf(process.env.CI)('validates input', () => { ... })
describe.skip('quarantined', () => {
  it('validates input', () => { ... })
})
```

### Assertion Count Reduction

Removing `expect()` calls from a test:

```typescript
// Before — 3 assertions
expect(result.id).toBe(1)
expect(result.name).toBe('Alice')
expect(result.email).toBe('alice@test.com')
// After — FLAGGED: reduced to 1 assertion
expect(result.id).toBe(1)
```

### Tautological Assertions

Replacing real assertions with self-proving statements:

```typescript
// FLAGGED
expect(true).toBe(true)
expect(false).toBe(false)
```

### Weak New Tests

New tests (or renamed tests) that only use low-strength assertions:

```typescript
// FLAGGED — all assertions are strength <= 4
it('works', () => {
  expect(doEverything()).toBeDefined()
})
```

### Suspicious Assertions

Assertion calls the AST cannot statically resolve. Rather than becoming invisible, they are flagged — the analyzer fails closed:

```typescript
// FLAGGED — the matcher cannot be verified statically
const method = 'toBeDefined'
expect(result)[method]()
```

Suspicious calls still count toward the assertion total, so indirection isn't double-reported as a count reduction.

## Hardened Against Evasion

The analyzer parses tests with a real AST rather than regexes, and has been adversarially tested against these attack vectors:

- **Reordering and padding** — assertions are compared as a sorted multiset of strengths, so shuffling assertions or padding with weak ones cannot hide a removed strong assertion
- **`it.each` replacement** — parameterized tests (`it.each`, `test.each`, `it.concurrent.each`) are parsed; replacing precise tests with a weak `.each` is flagged
- **Dynamic matcher calls** — `expect(x)[method]()` fails closed as `suspicious-assertion`
- **Skip variants** — `xit`, `xtest`, `.todo`, `describe.skip` ancestors, and conditional `.skipIf`/`.runIf` all register as skips
- **Comments** — commented-out assertions are ignored by the parser, including block comments
- **Template literal names** — `` `${variable}` `` expressions in test names are normalized and matched across versions
- **Modifier chains** — `.not`, `.resolves`, `.rejects`, and `expect.soft` chains resolve to their underlying matcher
- **Identity collisions** — same-named tests in different `describe` blocks are tracked separately by describe path
- **31 assertion methods** tracked, with unknown custom matchers scored at a neutral strength instead of zero

See [Adversarial Testing](../adversarial.md) for the full catalog of tested attack vectors.
