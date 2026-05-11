# Configuration

vibecheck is configured via a `vibecheck.config.ts` file at the project root. Run `npx vibecheck init` to generate one with sensible defaults.

## Full Schema

```typescript
import { defineConfig } from 'vibecheck-tdd'

export default defineConfig({
  // Glob patterns that identify test files
  testPatterns: [
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/__tests__/**/*.ts',
  ],

  // Branch to compare against for semantic diff and protection checks
  protectedBranch: 'main',

  // Mutation testing configuration
  mutation: {
    enabled: true,
    tool: 'stryker',          // Only Stryker is supported currently
    threshold: 80,            // Minimum overall mutation score (0-100)
    perFileThreshold: 60,     // Minimum per-file mutation score
    include: ['src/**/*.ts'], // Files to mutate
    exclude: [                // Files to skip
      'src/**/*.d.ts',
      'src/**/index.ts',
    ],
  },

  // Semantic diff analysis configuration
  semanticDiff: {
    enabled: true,
    enforcement: 'block',     // 'block' | 'warn' | 'comment'
    patterns: [               // Which weakening patterns to detect
      'precision-reduction',
      'error-relaxation',
      'bound-loosening',
      'test-deletion',
      'skip-addition',
      'assertion-count-reduction',
    ],
  },

  // Hidden test suites (not visible to the agent)
  hiddenTests: {
    enabled: true,
    source: 'directory',      // 'directory' | 'repo'
    path: '.vibecheck-hidden',
  },

  // Property-based testing requirements
  propertyTests: {
    enabled: false,
    framework: 'fast-check',  // 'fast-check' | 'hypothesis' | 'jsverify'
    requiredFor: [],          // Glob patterns for files requiring property tests
    minIterations: 1000,
  },

  // Output format
  reporters: ['console'],     // 'console' | 'github' | 'gitlab'
})
```

## Mutation Testing

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable mutation testing |
| `tool` | `'stryker'` | `'stryker'` | Mutation testing framework |
| `threshold` | `number` | `80` | Minimum overall mutation score |
| `perFileThreshold` | `number` | `60` | Minimum per-file mutation score |
| `include` | `string[]` | `['src/**/*.ts']` | Files to include in mutation |
| `exclude` | `string[]` | `['src/**/*.d.ts', 'src/**/index.ts']` | Files to exclude |

## Semantic Diff

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable semantic diff analysis |
| `enforcement` | `'block' \| 'warn' \| 'comment'` | `'block'` | How to handle violations |
| `patterns` | `string[]` | all patterns | Which weakening patterns to detect |

## Hidden Tests

Hidden tests can be sourced from a local directory or a private git repository:

=== "Local directory"

    ```typescript
    hiddenTests: {
      enabled: true,
      source: 'directory',
      path: '.vibecheck-hidden',
    }
    ```

=== "Private repo"

    ```typescript
    hiddenTests: {
      enabled: true,
      source: 'repo',
      url: 'git@github.com:org/hidden-tests.git',
      branch: 'main',
    }
    ```

=== "Disabled"

    ```typescript
    hiddenTests: {
      enabled: false,
    }
    ```

## Property Tests

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable property test requirements |
| `framework` | `string` | `'fast-check'` | Property testing framework |
| `requiredFor` | `string[]` | `[]` | Glob patterns for files requiring property tests |
| `minIterations` | `number` | `1000` | Minimum iterations per property |

## Config Protection

vibecheck's pre-commit hook prevents agents from modifying the config file alongside implementation changes. This stops an agent from sneaking in threshold reductions or disabling analyzers as part of a feature commit. See [Pre-commit Hook](pre-commit.md) for details.
