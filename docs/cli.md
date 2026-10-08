# CLI Reference

## Commands

### `vibecheck init`

Scaffold a new project with vibecheck configuration.

```bash
npx vibecheck init
```

Creates:

- `vibecheck.config.ts` with default settings
- `.vibecheck-hidden/` directory for hidden tests
- `.github/workflows/vibecheck.yml` (if `.github/workflows/` exists)
- A pre-commit hook: appended to `.husky/pre-commit` when Husky is present, otherwise `.git/hooks/pre-commit`. An existing hook is kept; the vibecheck line is added. Skipped when the directory is not a git checkout.
- Prints a CLAUDE.md snippet to stdout

### `vibecheck check`

Run all enabled analyzers and report the composite integrity score.

```bash
npx vibecheck check
npx vibecheck check --mutation      # Mutation analysis only
npx vibecheck check --semantic      # Semantic diff only
npx vibecheck check --threshold 90  # Override the composite score threshold
npx vibecheck check --hook          # Pre-commit: staged files and enforcement only
```

Exit code 0 when every gate passes, 1 otherwise. See [Pass/Fail](scoring.md#passfail) for the gates.

| Flag | Description |
|------|-------------|
| `--mutation` | Run only mutation testing |
| `--semantic` | Run only semantic diff analysis |
| `--threshold <n>` | Override the composite score threshold (0-100). The mutation thresholds are not affected. |
| `--base <ref>` | Read the config from `<ref>` and fail if the working-tree config weakens it. Implied in CI, with `origin/<protectedBranch>` as the ref. |
| `--hook` | Pre-commit mode. Classifies staged files, blocks edits to tests that already exist on the protected branch, and exits from the enforcement level (`block` rejects, `warn` prints and allows, `off` skips). Does not run mutation or semantic diff. |

### `vibecheck score`

Output the composite integrity score as a plain number (0-100). Useful for scripting.

```bash
npx vibecheck score
# Output: 85
```

### `vibecheck report`

Generate a full integrity report with per-analyzer breakdown.

```bash
npx vibecheck report
```

### `vibecheck help`

Print usage information.

```bash
npx vibecheck help
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All checks passed |
| `1` | A gate failed: composite score, mutation score, or blocking semantic violations |

## Environment Variables

vibecheck reads configuration from `vibecheck.config.ts` in the current working directory. No environment variables are required for basic usage.
