# Pre-commit Hook

vibecheck includes a pre-commit hook that enforces the two-phase commit protocol and protects configuration files.

## What It Enforces

### Two-Phase Commit Protocol

A commit must contain **either** test files **or** implementation files, not both.

```
vibecheck: Two-phase commit violation

  A commit must contain EITHER test files OR implementation files, not both.

  Test files staged:
    src/feature.test.ts

  Implementation files staged:
    src/feature.ts

  Split this into two commits:
    1. Commit tests first:          git commit -m "test: ..."
    2. Commit implementation second: git commit -m "feat: ..."
```

This forces a clean separation: tests define the contract, implementation satisfies it.

### Config Protection

Config files (`vibecheck.config.ts`, `vibecheck.config.js`, `.vibecheck.config.*`) cannot be committed alongside implementation files:

```
vibecheck: Config protection violation

  Config files must be committed separately from implementation
  files. Config changes should be reviewed separately.
```

Config changes alongside test files are allowed.

### File Classification

| Pattern | Classification |
|---------|---------------|
| `*.test.ts`, `*.test.tsx`, `*.test.js`, `*.test.jsx` | Test file |
| `*.spec.ts`, `*.spec.tsx`, `*.spec.js`, `*.spec.jsx` | Test file |
| `__tests__/*` | Test file |
| `vibecheck.config.*`, `.vibecheck.config.*` | Config file |
| `*.ts`, `*.tsx`, `*.js`, `*.jsx` (not matching above) | Implementation file |
| Everything else (`.md`, `.json`, `.yml`, etc.) | Ignored — always allowed |

## Installation

The hook is installed at `hooks/pre-commit` in the vibecheck package. To use it:

### Manual Installation

```bash
cp node_modules/vibecheck-tdd/hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

### Via `vibecheck init`

```bash
npx vibecheck init
```

This installs the hook automatically.

## What's Allowed

These commit patterns are **not blocked**:

- Test files only (Phase 1)
- Implementation files only (Phase 2)
- Non-code files alongside anything (README, package.json, etc.)
- Config files alongside test files
- Config files alone
- Empty commits

## Bypassing

!!! warning "Don't bypass the hook"
    `git commit --no-verify` skips all pre-commit hooks. This is a known limitation of git hooks. If you're using vibecheck in CI (recommended), the CI check will catch violations that slip past the hook.

The hook is a local safeguard. CI integration provides the enforcement backstop. See [CI Integration](ci.md).
