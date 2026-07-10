# Semantic Diff Analysis

The semantic diff analyzer detects assertion weakening between commits. When an agent modifies a test file, vibecheck compares the before and after versions to catch subtle quality reductions.

## How It Works

1. Parse the before and after versions of the file into a real AST (`@babel/parser`, TypeScript + JSX)
2. Extract every test — including `it.each`, `test.concurrent`, `xit`, and `it.todo` variants — with its full `describe` path, skip state, and assertion chains
3. Match tests across versions by describe-path-qualified identity, falling back to bare-name matching so moving a test between `describe` blocks doesn't read as a deletion
4. Compare the **sorted multiset** of assertion strengths rank by rank: reordering assertions is not weakening, and padding with weak assertions cannot hide a removed strong one
5. Anything the AST cannot statically resolve — like `expect(x)[method]()` — fails closed as a `suspicious-assertion` violation

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
