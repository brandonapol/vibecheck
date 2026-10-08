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
- `.gitlab/vibecheck.yml` (if `.gitlab-ci.yml` already exists; that file is not rewritten)
- A pre-commit hook: appended to `.husky/pre-commit` when Husky is present, otherwise `.git/hooks/pre-commit`. An existing hook is kept; the vibecheck line is added. Skipped when the directory is not a git checkout.
- When `.claude/` already exists, `.claude/hooks/vibecheck-protected.sh`. `settings.json` is created only if it is missing. An existing settings file is never rewritten; init prints where the snippet lives instead.
- Prints a CLAUDE.md snippet to stdout

### `vibecheck status`

List test files and whether each one exists on the protected branch. `protected` means an edit is enforced. `new` means the file is not on that branch yet.

```bash
npx vibecheck status
```

```
vibecheck: test protection

src/core/
  protected  validator.test.ts
  new        extra.test.ts
```

### `vibecheck protected`

Exit 2 when the path is a test that already exists on the protected branch. Exit 0 otherwise (not a test, or a test that is new). Claude Code's PreToolUse hook treats exit 2 as a block. See [Claude Code Hook](claude-hook.md).

```bash
npx vibecheck protected --file src/core/validator.test.ts
```

### `vibecheck check`

Run all enabled analyzers and report the composite integrity score.

```bash
npx vibecheck check
npx vibecheck check --mutation      # Mutation analysis only
npx vibecheck check --semantic      # Semantic diff only
npx vibecheck check --threshold 90  # Override the composite score threshold
npx vibecheck check --hook          # Pre-commit: staged files and enforcement only
```

Exit code 0 when every gate passes, 1 otherwise. See [Pass/Fail](scoring.md#passfail) for the gates. In CI (the `CI` environment variable) the diff and file contents come from `HEAD`. Locally they come from the working tree. When `hiddenTests.enabled` is true, this command runs that suite; `--mutation`, `--semantic`, and `--hook` do not.

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
| `0` | All checks passed, or `protected` found the path is not a protected test |
| `1` | A gate failed: composite score, mutation score, or blocking semantic violations |
| `2` | `protected` refused the path: it is a test on the protected branch, or `--file` was omitted |

## Environment Variables

vibecheck reads configuration from `vibecheck.config.ts` in the current working directory. No environment variables are required for basic usage.
