# Getting Started

## Installation

```bash
npm install vibecheck-tdd --save-dev
```

## Initialize Your Project

```bash
npx vibecheck init
```

This creates:

- **`vibecheck.config.ts`** — configuration with sensible defaults
- **`.vibecheck-hidden/`** — directory for hidden test suites (if enabled)
- **`.github/workflows/vibecheck.yml`** — CI workflow (if `.github/workflows/` exists)
- **CLAUDE.md snippet** — printed to stdout for you to append to your project's CLAUDE.md

## Run Your First Check

```bash
npx vibecheck check
```

This runs all enabled analyzers and reports a composite integrity score. By default, mutation testing and semantic diff analysis are enabled.

## Understanding the Output

```
vibecheck: Test Integrity Score — 85/100 (threshold: 80) PASS

  Mutation Score:       90% (threshold: 80)
  Semantic Diff:        100%
```

- **Mutation Score** — percentage of code mutations caught by your tests. Higher is better.
- **Semantic Diff** — percentage of assertions that haven't been weakened. 100% means no weakening detected.
- **Total Score** — weighted average of all enabled analyzers. Must meet the threshold to pass.

## Two-Phase Commit Protocol

vibecheck enforces a strict separation between test and implementation commits:

**Phase 1 — Write tests**

Write tests that describe the desired behavior. Commit them alone:

```bash
git add src/feature.test.ts
git commit -m "test: add tests for feature"
```

**Phase 2 — Write implementation**

Write implementation to make the tests pass. Commit separately:

```bash
git add src/feature.ts
git commit -m "feat: implement feature"
```

The pre-commit hook blocks commits that mix test and implementation files. See [Pre-commit Hook](pre-commit.md) for details.

## Next Steps

- [Configuration](configuration.md) — customize analyzers, thresholds, and patterns
- [CLI Reference](cli.md) — all available commands and flags
- [CI Integration](ci.md) — set up GitHub Actions
- [CLAUDE.md Template](claude-template.md) — instruct AI agents to follow the protocol
