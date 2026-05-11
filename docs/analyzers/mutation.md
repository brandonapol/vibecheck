# Mutation Testing

Mutation testing is the strongest single signal for test quality. It works by making small changes (mutations) to your source code and checking whether your tests catch them. If a test suite passes despite a mutation, the tests are too weak.

## How It Works

1. vibecheck runs [Stryker](https://stryker-mutator.io/) against your source files
2. Stryker creates mutations: replacing `+` with `-`, `true` with `false`, removing function calls, etc.
3. Your tests run against each mutant
4. **Killed mutants** = tests caught the change (good)
5. **Surviving mutants** = tests didn't notice (bad)

The mutation score is: `killed / total * 100`

## Why It Catches Agents

An agent that writes `expect(result).toBeDefined()` will get a low mutation score because the assertion passes regardless of what `result` actually contains. The agent would need to write `expect(result).toBe(42)` to kill the mutants.

## Configuration

```typescript
mutation: {
  enabled: true,
  tool: 'stryker',
  threshold: 80,          // Fail if overall score is below this
  perFileThreshold: 60,   // Fail if any single file is below this
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.d.ts'],
}
```

## Example Output

```
Mutation Score: 82% (threshold: 80)

Surviving mutants:
  src/core/calculator.ts:42 — ArithmeticOperator: replaced + with -
  src/core/calculator.ts:58 — ConditionalExpression: replaced > with >=
```

Each surviving mutant tells you exactly where your tests are weak: line number, mutation type, and what was changed.

## Thresholds

- **`threshold`** (default: 80) — minimum overall mutation score across all files
- **`perFileThreshold`** (default: 60) — minimum score for any individual file, prevents agents from concentrating weak tests in a few files while keeping the average high

## Limitations

Mutation testing is computationally expensive. A large codebase can take minutes to test. Use the `include` and `exclude` patterns to scope it to critical code paths.

An agent can still game mutation testing by writing tests that are technically precise but only cover happy paths. That's why vibecheck combines it with other analyzers.
