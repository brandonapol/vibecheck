# API Reference

vibecheck exports its core modules for programmatic use. Install the package and import what you need:

```typescript
import {
  calculateScore,
  extractScores,
  checkMutationThresholds,
  detectWeakeningInDiff,
  ASSERTION_STRENGTH,
  formatReport,
  runCheck,
} from 'vibecheck-tdd'
```

## Score Calculator

### `calculateScore(results, weights)`

Compute the composite integrity score from analyzer results.

```typescript
import { calculateScore } from 'vibecheck-tdd'
import type { AnalyzerResults, Weights } from 'vibecheck-tdd'

const results: AnalyzerResults = {
  mutation: { score: 85, enabled: true },
  semanticDiff: { weakeningRate: 0.1, enabled: true },
  hiddenTests: { passRate: 0, enabled: false },
  propertyTests: { coverage: 0, enabled: false },
}

const weights: Weights = {
  mutation: 40,
  semanticDiff: 10,
  hiddenTests: 30,
  propertyTests: 20,
}

const score = calculateScore(results, weights)
// { total: 87, components: { mutation: 85, semanticDiff: 90 } }
```

**Returns:** `IntegrityScore`

```typescript
type IntegrityScore = {
  total: number          // 0-100, weighted average
  components: {
    mutation?: number
    semanticDiff?: number
    hiddenTests?: number
    propertyTests?: number
  }
}
```

## Semantic Diff

### `detectWeakeningInDiff(before, after, file)`

Compare two versions of a test file and detect assertion weakening.

```typescript
import { detectWeakeningInDiff } from 'vibecheck-tdd'

const before = `
  it('returns user', () => {
    expect(getUser(1)).toEqual({ id: 1, name: 'Alice' })
  })
`

const after = `
  it('returns user', () => {
    expect(getUser(1)).toBeDefined()
  })
`

const violations = detectWeakeningInDiff(before, after, 'user.test.ts')
// [{ file: 'user.test.ts', pattern: 'precision-reduction', detail: '...' }]
```

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `before` | `string` | Source code of the file before changes |
| `after` | `string` | Source code of the file after changes |
| `file` | `string` | Filename (used in violation messages) |

**Returns:** `WeakeningViolation[]`

```typescript
type WeakeningViolation = {
  file: string
  pattern: WeakeningPattern
  detail: string
}

type WeakeningPattern =
  | 'precision-reduction'
  | 'error-relaxation'
  | 'bound-loosening'
  | 'test-deletion'
  | 'skip-addition'
  | 'assertion-count-reduction'
  | 'tautological-assertion'
  | 'weak-new-test'
```

### `ASSERTION_STRENGTH`

The strength ranking map used by the semantic diff analyzer.

```typescript
import { ASSERTION_STRENGTH } from 'vibecheck-tdd'

ASSERTION_STRENGTH['toBe']       // 10
ASSERTION_STRENGTH['toEqual']    // 9
ASSERTION_STRENGTH['toBeDefined'] // 2
```

### `detectWeakeningWithAdapter(before, after, file, adapter)`

The language-agnostic form of `detectWeakeningInDiff`. It extracts both versions with `adapter` and ranks matchers with `adapter.assertionStrength`. Returns a promise, because an adapter may run an external parser. Extraction errors propagate; they are never reported as a clean diff.

## Languages

### `LanguageAdapter`

```typescript
type LanguageAdapter = {
  id: string
  testPatterns: string[]      // default test-file globs
  sourcePatterns: string[]    // default mutation targets
  extractTests(source: string, path: string): Promise<ExtractedTest[]>
  extractSetup(source: string, path: string): Promise<SetupStatement[]>
  assertionStrength(matcher: string): number   // 0-10; 4 and below is weak
  runMutation?(options: MutationRunOptions): Promise<CountedMutationReport>
}
```

### `registerAdapter(adapter)`

Make an adapter available to `languages` config entries with the same `id`. Returns a function that unregisters it. Registering an id twice throws.

### `resolveLanguages(config)` / `languageForFile(file, languages)`

`resolveLanguages` turns the config into one entry per language, with every fallback applied. `languageForFile` returns the first enabled language whose test patterns match a path, or `null`.

### `runMutationForLanguages(config)`

Run each enabled language's mutation engine and merge the results with `mergeMutationReports`.

## Mutation Testing

### `extractScores(strykerOutput)`

Parse Stryker JSON output into per-file mutation scores, plus the `killed` and `total` mutant counts.

### `mergeMutationReports(reports)`

Combine reports from several languages. The overall score is weighted by mutant count, not averaged per report.

### `checkMutationThresholds(scores, threshold, perFileThreshold)`

Check whether mutation scores meet the configured thresholds.

## Runner

### `runCheck(config, inputs)`

Run the full vibecheck pipeline: scoring, the pass/fail gates (see [Scoring](scoring.md#passfail)), and report generation.

```typescript
import { runCheck } from 'vibecheck-tdd'
import { defineConfig } from 'vibecheck-tdd'

const config = defineConfig({})
const result = await runCheck(config, {
  mutationScore: 85,
  semanticViolations: [],
})

console.log(result.pass)      // true
console.log(result.score)     // { total: 88, components: { ... } }
console.log(result.failures)  // [] — one line per failed gate otherwise
console.log(result.report)  // formatted string
```

**Returns:** `CheckResult`

```typescript
type CheckResult = {
  pass: boolean
  score: IntegrityScore
  report: string
}
```

## Reporter

### `formatReport(score, violations, mutationReport?)`

Format a score and violations into a human-readable console report.

```typescript
import { formatReport } from 'vibecheck-tdd'

const report = formatReport(score, violations, mutationReport)
console.log(report)
```

## Configuration

### `defineConfig(config)`

Validate and apply defaults to a partial configuration object.

```typescript
import { defineConfig } from 'vibecheck-tdd'

const config = defineConfig({
  mutation: { threshold: 90 },
})
// Returns full Config with all defaults applied
```
