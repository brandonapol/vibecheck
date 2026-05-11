# Semantic Diff Analysis

The semantic diff analyzer detects assertion weakening between commits. When an agent modifies a test file, vibecheck compares the before and after versions to catch subtle quality reductions.

## How It Works

1. Extract test blocks from the before and after versions of a file
2. Match tests by name across versions
3. Compare assertion methods at each position within matched tests
4. Flag any reduction in assertion strength

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

Adding `.skip` to disable a test:

```typescript
// Before
it('validates input', () => { ... })
// After — FLAGGED
it.skip('validates input', () => { ... })
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

## Hardened Against Evasion

The analyzer has been adversarially tested and hardened against these attack vectors:

- **Comment stripping** — assertions inside `//` or `/* */` comments are excluded before analysis
- **Template literal names** — test names using `` `${variable}` `` template expressions are parsed correctly
- **`it.each` support** — parameterized tests using `it.each()` are recognized
- **31 assertion methods** tracked — including numeric comparisons, mock matchers, and snapshot methods

See [Adversarial Testing](../adversarial.md) for the full catalog of tested attack vectors.
