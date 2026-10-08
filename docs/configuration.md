# Configuration

vibecheck is configured via a `vibecheck.config.ts` file at the project root. Run `npx vibecheck init` to generate one with sensible defaults. The CLI loads that file with [jiti](https://github.com/unjs/jiti), so plain Node can run it. You do not need `tsx` or a compiled config.

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

  // Minimum composite integrity score; see Scoring for the other gates
  threshold: 80,

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
    enforcement: 'block',     // 'block' fails on any violation; 'warn' | 'comment' only report
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
    threshold: 100,
    enforcement: 'block',     // 'block' | 'warn'
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
| `enforcement` | `'block' \| 'warn' \| 'comment'` | `'block'` | `'block'` fails the check on any violation, whatever the score; `'warn'` and `'comment'` report without failing |
| `patterns` | `string[]` | all patterns | Which weakening patterns to detect |

## Hidden Tests

Holdout tests the agent is not supposed to read. Off unless `enabled` is true. See [Hidden tests](analyzers/hidden-tests.md) for what runs and how a private repo is cloned.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Run the holdout suite during `check` / `score` / `report` |
| `source` | `'directory' \| 'repo'` | — | Required when enabled |
| `path` | `string` | — | Directory inside the project. Required for `source: 'directory'` |
| `url` | `string` | — | Git URL. Required for `source: 'repo'` |
| `branch` | `string` | `'main'` | Branch to clone |
| `tool` | `'vitest'` | `'vitest'` | Project-local Vitest only |
| `threshold` | `number` | `100` | Minimum pass rate. Below this fails when enforcement is `block` |
| `enforcement` | `'block' \| 'warn'` | `'block'` | `warn` records the rate and does not fail the check on it |

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

## Languages

By default vibecheck analyzes TypeScript only, configured by the top-level `testPatterns` and `mutation` fields. To analyze other languages, list them under `languages`. Each entry needs a registered language adapter; TypeScript, Go, and Dart ship built in (see the [multi-language epic](https://github.com/brandonapol/vibecheck/issues/84)). Go and Dart have semantic diff only for now, so set `mutation: { enabled: false }` on them until their mutation engines land (#79, #82).

```typescript
export default defineConfig({
  languages: {
    typescript: {},                       // falls back to the top-level fields
    go: {
      testPatterns: ['**/*_test.go'],     // optional: defaults come from the adapter
      mutation: { enabled: false },       // no Go mutation engine yet (#79)
    },
  },
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Analyze this language |
| `testPatterns` | `string[]` | top-level `testPatterns` for TypeScript, otherwise the adapter's | Which changed files the semantic diff reads with this language's adapter |
| `mutation.enabled` | `boolean` | `true` | Run this language's mutation engine |
| `mutation.include` | `string[]` | top-level `mutation.include` for TypeScript, otherwise the adapter's | Files to mutate |
| `mutation.exclude` | `string[]` | top-level `mutation.exclude` for TypeScript, otherwise `[]` | Files to skip |

Once `languages` lists anything, only the listed languages run: add `typescript: {}` to keep TypeScript alongside another language. Thresholds stay global. Every language's mutants are merged into one report, so `mutation.threshold` applies to the combined score and `mutation.perFileThreshold` to every file.

A language with no registered adapter is an error, not a skipped language. So is a language with mutation enabled whose adapter has no mutation engine.

## Protected Tests

Some tests enforce a repo-wide rule (a test that scans the codebase for raw error strings, say), and some conventions every test of a kind must follow (every widget test covers a narrow and a wide viewport). Weakening those is worse than weakening an ordinary test, so they get their own gate.

```typescript
protectedTests: {
  // Any weakening in these files blocks, whatever semanticDiff.enforcement
  // says and whatever the score. Deleting one blocks too.
  files: ['test/utils/error_text_test.dart', 'test/lint/**'],
  // A changed file matching `path` must keep every identifier it referenced
  // on the base branch.
  required: [
    { path: 'packages/*/test/**/*_test.dart', references: ['narrowViewport', 'wideViewport'] },
  ],
},
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `files` | `string[]` (globs) | `[]` | Test files where any semantic diff finding, from any pattern even if disabled, or deleting the file, fails the check |
| `required` | `{ path, references }[]` | `[]` | For changed files matching `path`, each identifier in `references` that the base version used must still appear (whole-word match). Deleting the file counts as removing them all. |

Notes:

- Protected files are diffed even when `semanticDiff.enabled` is `false`, but only if a language adapter claims them (`testPatterns`).
- `required` applies only to files that exist on the base branch. A new file that never referenced the identifiers isn't held to the rule, since it has nothing to lose. Requiring the identifiers in every new file is a lint rule, not a weakening check.
- Removing a protected file from `files`, dropping a `required` rule, or dropping an identifier from one is reported as config weakening.

## Commit Identity

The pre-commit validator applies a different enforcement level depending on who appears to be committing.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `agentTrailers` | `string[]` | Claude, Copilot, Cursor `Co-Authored-By` lines | Commit-message trailers that mark an agent commit |
| `agentEnvVars` | `string[]` | `['CLAUDECODE']` | Environment variables whose non-empty presence marks an agent session. Claude Code sets `CLAUDECODE` in every shell it runs. |
| `enforcement.agents` | `'block' \| 'warn' \| 'off'` | `'block'` | A commit with an agent signal |
| `enforcement.unknown` | `'block' \| 'warn' \| 'off'` | `'block'` | A commit with no agent signal |
| `enforcement.humans` | | `'warn'` | Deprecated and unused. Kept so existing configs still parse. |

There's no `human` identity because nothing proves a commit is human. Leaving out a trailer is the easiest state for an agent to be in, and many setups (this repository's included) tell agents never to add one. So a commit with no agent signal is `unknown` and is enforced strictly by default. Set `enforcement.unknown: 'warn'` if you want a softer local hook for people while detected agents stay blocked.

Every signal here is advisory: an agent can strip its trailer and unset its environment. CI is the enforcement boundary, and `vibecheck check` applies its gates to every commit regardless of identity. Lowering either level, or removing an agent environment variable, is reported as config weakening.

## Property Tests

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable property test requirements |
| `framework` | `string` | `'fast-check'` | Property testing framework |
| `requiredFor` | `string[]` | `[]` | Glob patterns for files requiring property tests |
| `minIterations` | `number` | `1000` | Minimum iterations per property |

## Config Protection

vibecheck's pre-commit hook prevents agents from modifying the config file alongside implementation changes. This stops an agent from sneaking in threshold reductions or disabling analyzers as part of a feature commit. See [Pre-commit Hook](pre-commit.md) for details.

In CI, `vibecheck check` reads the config from the base branch and fails when the PR's own config weakens it. See [CI Integration](ci.md#config-comes-from-the-base-branch).

Config-weakening detection also covers `languages`: removing or disabling a language, disabling its mutation analysis, dropping test patterns or includes, and adding excludes are all reported.
