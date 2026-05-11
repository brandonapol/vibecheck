# vibecheck-tdd

**A CI-native test integrity pipeline that prevents AI coding agents from gaming their own test suites.**

vibecheck measures test *quality*, not just test *existence*. It catches the ways AI agents cheat — weak assertions, deleted tests, tautological checks — and blocks them before they ship.

## The Problem

AI coding agents (Claude Code, Copilot, Cursor, etc.) have full context of both tests and implementation simultaneously. Nothing stops an agent from:

- Writing trivially satisfiable tests (`expect(result).toBeDefined()`)
- Weakening assertions to make broken implementations pass
- Deleting or skipping tests that are hard to satisfy
- Replacing real assertions with tautologies (`expect(true).toBe(true)`)
- Commenting out assertions instead of using `.skip`
- Renaming tests to evade diff-based detection

Pre-commit hooks that lock test files are a **logical** constraint — the agent understands the rule and routes around it. vibecheck uses **structural** constraints that are much harder to game.

## How It Works

vibecheck layers four complementary checks into a composite integrity score (0-100):

| Analyzer | What it catches | Weight |
|----------|----------------|--------|
| **Mutation testing** (Stryker) | Weak assertions that survive code mutations | 40% |
| **Hidden test suites** | Tests fitted to implementation instead of spec | 30% |
| **Property-based tests** | Hardcoded return values | 20% |
| **Semantic diff analysis** | Retroactive assertion weakening | 10% |

Each analyzer targets a different evasion strategy. Together, they make it structurally difficult for an agent to produce code that passes all checks without genuinely satisfying the specification.

## Quick Example

```bash
npm install vibecheck-tdd --save-dev
npx vibecheck init
npx vibecheck check
```

```
vibecheck: Test Integrity Score — 74/100 (threshold: 80) FAIL

  Mutation Score:       82% (threshold: 80)
  Semantic Diff:        70%

  Surviving mutants:
    src/core/calculator.ts:42 — ArithmeticOperator: replaced with -
    src/core/calculator.ts:58 — ConditionalExpression: replaced with true

  Assertion weakening detected:
    src/core/calculator.test.ts — precision-reduction: .toEqual() weakened to .toBeDefined()
```

## Current Status

vibecheck is at **v0.2.0**. The mutation testing analyzer, semantic diff analyzer, composite scoring, CLI, pre-commit hook, and CI integration are all functional. See the [roadmap](#roadmap) for what's coming next.

## Roadmap

**v0.3.0** — Agent identity detection. Distinguish agent vs human commits via git trailers, apply different enforcement levels.

**v0.4.0** — Hidden test suite runner, `vibecheck audit` for retroactive history scanning, GitLab CI support.

**v0.5.0** — VSCode extension with visual file locking indicators, monorepo support.
