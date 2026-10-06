# Scoring

vibecheck combines analyzer results into a single composite integrity score from 0-100.

## How It's Calculated

Each enabled analyzer produces a score from 0-100. These are combined using a weighted average:

| Analyzer | Default Weight | Score Derivation |
|----------|---------------|-----------------|
| Mutation testing | 40% | Stryker mutation score directly |
| Hidden tests | 30% | Pass rate of hidden test suite |
| Property tests | 20% | Coverage of required property tests |
| Semantic diff | 10% | `(1 - weakeningRate) * 100` |

```
total = sum(weight_i * score_i) / sum(weight_i)
```

Only enabled analyzers contribute to both numerator and denominator. This means disabling an analyzer doesn't inflate the score — it just removes that dimension from the calculation.

## Edge Cases

### No Analyzers Enabled

If all analyzers are disabled, the score is **0** (not 100). This prevents an agent from achieving a perfect score by simply turning everything off.

### Single Analyzer

If only one analyzer is enabled, the total score equals that analyzer's score. For example, with only mutation testing enabled at 85%, the total is 85.

## Pass/Fail

The composite score is a quality signal, not the only gate. A check passes only when all of these hold:

1. **Composite score** ≥ `threshold` (default **80**).
2. **Mutation score** ≥ `mutation.threshold`, and every file ≥ `mutation.perFileThreshold`, when mutation analysis is enabled.
3. **No semantic diff violations** when `semanticDiff.enforcement` is `'block'` (the default). Semantic diff carries only 10 of the score's weight, so at a perfect mutation score even unlimited weakening would still score 80. The gate is what stops it. Under `'warn'` or `'comment'`, violations are reported but don't fail the check.

Only violations of patterns listed in `semanticDiff.patterns` count, toward the score or the gate. The report lists every failed gate under **Blocking**.

```typescript
export default defineConfig({
  threshold: 80,            // composite score
  mutation: {
    threshold: 80,          // overall mutation score
    perFileThreshold: 60,   // every mutated file
  },
  semanticDiff: { enforcement: 'block' },
})
```

`--threshold` overrides the composite threshold for one run:

```bash
npx vibecheck check --threshold 90
```

## Component Breakdown

The score result includes per-component details:

```typescript
{
  total: 85,
  components: {
    mutation: 90,       // From Stryker
    semanticDiff: 100,  // No weakening detected
    // hiddenTests and propertyTests omitted when disabled
  }
}
```

Disabled analyzers don't appear in the components object.

## Weight Tuning

The default weights reflect the relative strength of each signal:

- **Mutation (40%)** — strongest single indicator of test quality
- **Hidden tests (30%)** — catches implementation-fitted tests that mutation testing might miss
- **Property tests (20%)** — catches hardcoded returns that pass both mutation and example-based tests
- **Semantic diff (10%)** — lightweight diff-based check, easy to compute but narrower scope

Adjust weights based on your project's priorities. If you don't use hidden tests, their weight redistributes across the remaining analyzers automatically.
