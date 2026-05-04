# agent-tdd

A pre-commit hook library that enforces test-first discipline on AI agents. See `TODO.md` for the full design doc.

## Git

- Do NOT add `Co-Authored-By` trailers to commits. Brandon is the sole author.
- Commit messages: use conventional commits (`feat:`, `test:`, `fix:`, `chore:`, `docs:`).
- Do not push unless explicitly asked.

## Development workflow

This project enforces its own philosophy: **write tests first, then implementation.**

For every module:
1. Write failing tests that describe the expected behavior.
2. Commit the tests alone (`test: add tests for <module>`).
3. Write the implementation to make the tests pass.
4. Commit the implementation (`feat: implement <module>`).

Never write tests and implementation in the same commit. If a test needs to change, that's its own commit with a clear reason.

## Tech stack

- **Runtime**: Node.js with TypeScript
- **Build**: tsup (cjs + esm + dts)
- **Test**: vitest
- **Deps**: execa (shell commands), micromatch (glob matching), zod (config validation), chalk (terminal output)

## Architecture

```
src/
  config/   — Zod schema + config file loader
  core/     — detector (agent ID), resolver (protected paths), validator (orchestrator)
  hooks/    — pre-commit hook entrypoint
  ci/       — standalone CI check
  index.ts  — public API
bin/
  agent-tdd.ts — CLI entrypoint
templates/
  github-actions.yml, CLAUDE.md
```

## Style

- Keep modules small and focused. Each file in `src/core/` does one thing.
- Use `execa` for all git subprocess calls — no `child_process` directly.
- Prefer returning result objects (`{ ok: true } | { ok: false, violations }`) over throwing.
- No classes unless there's a clear reason. Plain functions and types.

## Testing

- Tests live next to source: `src/core/resolver.test.ts` alongside `src/core/resolver.ts`.
- Mock git commands via execa — don't require a real git repo in unit tests.
- Integration tests that need a real repo go in `test/integration/` and can create temp git repos.

## MVP scope (v0.1.0)

Only these features — nothing else:
1. `agent-tdd init` — config scaffolding + hook installation
2. `agent-tdd check` — core validation
3. Pre-commit hook enforcement
4. GitHub Actions reusable workflow
5. CLAUDE.md template for downstream projects
6. TypeScript config schema with Zod

Track progress via GitHub issues on brandonapol/vibecheck.
