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
- Prints a CLAUDE.md snippet to stdout

### `vibecheck check`

Run all enabled analyzers and report the composite integrity score.

```bash
npx vibecheck check
npx vibecheck check --mutation      # Mutation analysis only
npx vibecheck check --semantic      # Semantic diff only
npx vibecheck check --threshold 90  # Override pass/fail threshold
```

Exit code 0 if the score meets the threshold, 1 otherwise.

| Flag | Description |
|------|-------------|
| `--mutation` | Run only mutation testing |
| `--semantic` | Run only semantic diff analysis |
| `--threshold <n>` | Override the minimum score (0-100) |

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
| `1` | Score below threshold or violations detected |

## Environment Variables

vibecheck reads configuration from `vibecheck.config.ts` in the current working directory. No environment variables are required for basic usage.
