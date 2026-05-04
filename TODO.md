# agent-tdd: Design Strategy

A pre-commit hook library that enforces test-first discipline on AI agents working in shared codebases. Think Husky, but with awareness of agent-authored commits.

---

## Problem Statement

AI coding agents (Claude Code, Copilot, Cursor, etc.) have full context of both tests and implementation simultaneously. Nothing in the default toolchain prevents an agent from:

- Retroactively weakening test assertions to make implementation pass
- Deleting or skipping tests that are hard to satisfy
- Writing tests and implementation in a single commit, defeating TDD entirely

This library enforces a two-phase commit protocol at the git hook and CI level, making test integrity a hard constraint rather than a prompt instruction.

---

## Core Concepts

### Two-Phase Protocol

**Phase 1 — Test Authoring**
The agent (or developer) writes tests only. No implementation files are touched. Tests are committed and merged. From this point, those test files are considered protected.

**Phase 2 — Implementation**
The agent writes implementation to satisfy the locked tests. Pre-commit hooks reject any modification to files protected in Phase 1.

### Protection Boundary

Protection is determined by:
1. Whether a file matches configured test patterns (e.g. `**/*.test.ts`, `**/*.spec.ts`)
2. Whether that file already exists in the target branch (main/master)

A test file that already exists in `main` is protected. A new test file being introduced in the current branch is not yet protected — it's still in Phase 1.

### Agent Identity

Agent commits are identified by git commit trailers. Claude Code appends `Co-Authored-By: Claude` trailers by default. The library uses this signal to apply stricter enforcement rules to agent commits vs human commits (configurable).

---

## Repository Structure

```
agent-tdd/
├── src/
│   ├── config/
│   │   ├── schema.ts          # Zod schema for agent-tdd.config.ts
│   │   └── loader.ts          # Config resolution and defaults
│   ├── core/
│   │   ├── detector.ts        # Agent identity detection from git trailers
│   │   ├── resolver.ts        # Protected path resolution against git history
│   │   └── validator.ts       # Core validation logic
│   ├── hooks/
│   │   ├── pre-commit.ts      # Pre-commit hook entrypoint
│   │   └── commit-msg.ts      # Optional commit message tagging
│   ├── ci/
│   │   └── check.ts           # Standalone CI check (no git hooks required)
│   └── index.ts               # Public API exports
├── templates/
│   ├── github-actions.yml     # Reusable GitHub Actions workflow
│   ├── gitlab-ci.yml          # GitLab CI template
│   └── CLAUDE.md              # Drop-in system prompt snippet for Claude Code
├── bin/
│   └── agent-tdd.ts           # CLI entrypoint
├── agent-tdd.config.ts        # Example config (also serves as documentation)
├── package.json
└── README.md
```

---

## Configuration Schema

```typescript
// agent-tdd.config.ts
import { defineConfig } from 'agent-tdd'

export default defineConfig({
  testPatterns: [
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/__tests__/**/*.ts',
  ],

  protectedBranch: 'main',

  agentTrailers: [
    'Co-Authored-By: Claude',
    'Co-Authored-By: GitHub Copilot',
    'Co-Authored-By: cursor',
  ],

  enforcement: {
    agents: 'strict',   // block commit entirely
    humans: 'warn',     // warn but allow (escape hatch for intentional test changes)
  },

  allowlist: [
    // Paths agents are always allowed to modify regardless of phase
    'src/**/*.mock.ts',
    'src/**/*.fixture.ts',
  ],

  hooks: {
    preCommit: true,
    commitMsg: false,   // opt-in: tags commits with [agent-tdd:phase1] etc.
  },
})
```

---

## Core Logic

### Protected Path Resolution

```typescript
// src/core/resolver.ts

const getProtectedPaths = async (
  stagedFiles: string[],
  testPatterns: string[],
  protectedBranch: string
): Promise<string[]> => {
  const testFiles = stagedFiles.filter(f => matchesPatterns(f, testPatterns))

  return Promise.all(
    testFiles.map(async f => {
      const existsInBranch = await fileExistsInBranch(f, protectedBranch)
      return existsInBranch ? f : null
    })
  ).then(results => results.filter(Boolean) as string[])
}

const fileExistsInBranch = (file: string, branch: string): Promise<boolean> =>
  execa('git', ['show', `origin/${branch}:${file}`])
    .then(() => true)
    .catch(() => false)
```

### Agent Detection

```typescript
// src/core/detector.ts

const isAgentCommit = async (trailers: string[]): Promise<boolean> => {
  const commitMsg = await execa('git', ['log', '-1', '--format=%B']).then(r => r.stdout)
  return trailers.some(trailer =>
    commitMsg.toLowerCase().includes(trailer.toLowerCase())
  )
}
```

### Validation

```typescript
// src/core/validator.ts

type ValidationResult =
  | { ok: true }
  | { ok: false; violations: Violation[] }

type Violation = {
  file: string
  reason: 'protected-test-modified'
  phase: 'implementation'
}

const validate = async (config: Config): Promise<ValidationResult> => {
  const staged = await getStagedFiles()
  const isAgent = await isAgentCommit(config.agentTrailers)
  const enforcementLevel = isAgent ? config.enforcement.agents : config.enforcement.humans

  if (enforcementLevel === 'off') return { ok: true }

  const protected_ = await getProtectedPaths(staged, config.testPatterns, config.protectedBranch)
  const allowlisted = protected_.filter(f => matchesPatterns(f, config.allowlist))
  const violations = protected_
    .filter(f => !allowlisted.includes(f))
    .map(file => ({ file, reason: 'protected-test-modified' as const, phase: 'implementation' as const }))

  return violations.length === 0
    ? { ok: true }
    : { ok: false, violations }
}
```

---

## CLI

```bash
npx agent-tdd init          # scaffold config + install hooks
npx agent-tdd check         # run validation manually (for CI)
npx agent-tdd status        # show which files are currently protected
npx agent-tdd audit         # scan git history for violations (retroactive)
```

### `init` flow

1. Detect package manager (npm/pnpm/yarn/bun)
2. Create `agent-tdd.config.ts` with sensible defaults
3. Install pre-commit hook (via `.husky/` or standalone `.git/hooks/pre-commit`)
4. Check for existing Husky setup and integrate rather than replace
5. Output CLAUDE.md snippet to stdout for user to append to their project CLAUDE.md

---

## Husky Integration

If Husky is already present, `init` appends to the existing hook rather than replacing it:

```bash
# .husky/pre-commit (after agent-tdd init)
npx lint-staged              # existing
npx agent-tdd check --hook   # appended by agent-tdd
```

If Husky is not present, agent-tdd installs a minimal standalone hook at `.git/hooks/pre-commit` with no additional dependencies.

---

## CI Integration

### GitHub Actions (reusable workflow)

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

The reusable workflow:
1. Diffs PR against base branch
2. Identifies modified test files that exist in base
3. Checks commit trailers for agent identity
4. Fails with a detailed violation report if protected tests were modified by an agent

### GitLab CI

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/your-org/agent-tdd/main/templates/gitlab-ci.yml'

agent-tdd:
  extends: .agent-tdd-check
  variables:
    PROTECTED_BRANCH: main
```

---

## CLAUDE.md Snippet

This is the prompt-level layer. It doesn't enforce anything on its own but aligns agent behavior with the toolchain:

```markdown
## Test Authoring Protocol

This project uses agent-tdd to enforce test integrity.

Follow this two-phase protocol strictly:

**Phase 1 — Tests only**
- Write failing tests that describe the desired behavior
- Do not write any implementation code
- Commit tests alone: `git commit -m "test: add tests for [feature]"`

**Phase 2 — Implementation only**  
- Write implementation to make Phase 1 tests pass
- Do not modify any test files that already exist in main
- Do not weaken assertions, skip tests, or change expected values to match broken behavior
- If a test seems wrong, flag it in a comment and ask the human to review — do not change it

The pre-commit hook will block your commit if you modify protected test files during Phase 2.
```

---

## Violation Output

When a violation is detected, the hook outputs a clear, actionable error:

```
agent-tdd: Protected test files modified during implementation phase

  BLOCKED  src/payments/charge.test.ts
           This file exists in main and cannot be modified by an agent.
           If this change is intentional, a human must commit it directly.

  Tip: Run `npx agent-tdd status` to see all currently protected files.

exit 1
```

---

## Package.json

```json
{
  "name": "agent-tdd",
  "version": "0.1.0",
  "description": "Pre-commit hooks that enforce test-first discipline on AI coding agents",
  "bin": {
    "agent-tdd": "./dist/bin/agent-tdd.js"
  },
  "scripts": {
    "build": "tsup src/index.ts bin/agent-tdd.ts --format cjs,esm --dts",
    "test": "vitest",
    "lint": "eslint src --ext .ts",
    "release": "np"
  },
  "keywords": [
    "ai-agents",
    "tdd",
    "pre-commit",
    "claude-code",
    "git-hooks",
    "testing",
    "devtools"
  ],
  "peerDependencies": {
    "husky": ">=8.0.0"
  },
  "peerDependenciesMeta": {
    "husky": { "optional": true }
  },
  "dependencies": {
    "execa": "^8.0.0",
    "micromatch": "^4.0.0",
    "zod": "^3.0.0",
    "chalk": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "tsup": "^8.0.0",
    "vitest": "^1.0.0",
    "@types/micromatch": "^4.0.0"
  }
}
```

---

## MVP Scope (v0.1.0)

Ship these, nothing else:

1. `agent-tdd init` — config scaffolding + hook installation
2. `agent-tdd check` — core validation logic
3. Pre-commit hook enforcement
4. GitHub Actions reusable workflow
5. CLAUDE.md template
6. TypeScript config schema with Zod validation

**Defer to v0.2.0:**
- VSCode extension (visual file locking indicator)
- GitLab CI template
- `agent-tdd audit` (retroactive history scan)
- Commit message tagging (`commit-msg` hook)
- Support for additional agent trailer formats beyond Claude/Copilot/Cursor

---

## Open Questions for v0.1.0

- **Identity fallback**: If no agent trailer is found, should enforcement default to human-level (warn) or agent-level (strict)? Recommend warn with a config override.
- **Monorepo support**: Should `protectedBranch` be per-package or global? Likely needs a `packages` array in config for Turborepo/Nx setups.
- **Test-only commits**: Should the hook enforce that Phase 1 commits contain *only* test files? This would be opt-in (`enforcePhase1: true`) to avoid being too prescriptive.
