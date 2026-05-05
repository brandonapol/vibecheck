# vibecheck-tdd

Pre-commit hooks that enforce test-first discipline on AI coding agents.

AI agents (Claude Code, Copilot, Cursor, etc.) have full context of both tests and implementation simultaneously. Nothing stops them from retroactively weakening assertions, deleting inconvenient tests, or writing tests and implementation in a single commit. **agent-tdd** makes test integrity a hard constraint rather than a prompt instruction.

## How it works

agent-tdd enforces a two-phase commit protocol:

**Phase 1 — Test authoring.** Write tests only. No implementation files are touched. Commit and merge. Those test files are now protected.

**Phase 2 — Implementation.** Write code to satisfy the locked tests. Pre-commit hooks reject any modification to files protected in Phase 1.

Protection is determined by two things:
1. Whether a file matches configured test patterns (e.g. `**/*.test.ts`)
2. Whether that file already exists in the target branch (main/master)

A test file in `main` is protected. A new test file in a feature branch is still in Phase 1 — not yet protected.

### Agent detection

Agent commits are identified by git commit trailers (`Co-Authored-By: Claude`, etc.). agent-tdd uses this signal to apply stricter enforcement to agent commits vs human commits (configurable).

## Quick start

```bash
npx agent-tdd init
```

This will:
1. Detect your package manager
2. Create `agent-tdd.config.ts` with sensible defaults
3. Install a pre-commit hook (integrates with Husky if present, or installs standalone)
4. Print a CLAUDE.md snippet you can append to your project's Claude Code instructions

## CLI

```bash
npx agent-tdd init      # scaffold config + install hooks
npx agent-tdd check     # run validation manually (for CI)
npx agent-tdd status    # show which files are currently protected
```

## Configuration

```typescript
// agent-tdd.config.ts
import { defineConfig } from 'agent-tdd'

export default defineConfig({
  // Glob patterns that identify test files
  testPatterns: [
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/__tests__/**/*.ts',
  ],

  // Branch where protected tests live
  protectedBranch: 'main',

  // Commit trailers that identify agent-authored commits
  agentTrailers: [
    'Co-Authored-By: Claude',
    'Co-Authored-By: GitHub Copilot',
    'Co-Authored-By: cursor',
  ],

  // Enforcement levels: 'strict' (block), 'warn' (allow with warning), 'off'
  enforcement: {
    agents: 'strict',
    humans: 'warn',
  },

  // Paths agents can always modify regardless of phase
  allowlist: [
    'src/**/*.mock.ts',
    'src/**/*.fixture.ts',
  ],

  // Which hooks to install
  hooks: {
    preCommit: true,
    commitMsg: false,
  },
})
```

## CI integration

### GitHub Actions

```yaml
# .github/workflows/agent-tdd.yml
name: Agent TDD Check

on:
  pull_request:
    branches: [main]

jobs:
  agent-tdd:
    uses: your-org/agent-tdd/.github/workflows/check.yml@main
    with:
      protected-branch: main
```

The workflow diffs the PR against the base branch, identifies modified test files that exist in base, checks commit trailers for agent identity, and fails with a violation report if protected tests were modified by an agent.

## Husky integration

If Husky is already present, `agent-tdd init` appends to your existing hook:

```bash
# .husky/pre-commit
npx lint-staged              # your existing hook
npx agent-tdd check --hook   # appended by agent-tdd
```

If Husky is not present, a standalone hook is installed at `.git/hooks/pre-commit`.

## Violation output

```
agent-tdd: Protected test files modified during implementation phase

  BLOCKED  src/payments/charge.test.ts
           This file exists in main and cannot be modified by an agent.
           If this change is intentional, a human must commit it directly.

  Tip: Run `npx agent-tdd status` to see all currently protected files.
```

## Using with Claude Code

Add this to your project's `CLAUDE.md`:

```markdown
## Test Authoring Protocol

This project uses agent-tdd to enforce test integrity.

**Phase 1 — Tests only**
- Write failing tests that describe the desired behavior
- Do not write any implementation code
- Commit tests alone: `git commit -m "test: add tests for [feature]"`

**Phase 2 — Implementation only**
- Write implementation to make Phase 1 tests pass
- Do not modify any test files that already exist in main
- Do not weaken assertions, skip tests, or change expected values
- If a test seems wrong, flag it and ask the human to review — do not change it
```

## License

MIT
