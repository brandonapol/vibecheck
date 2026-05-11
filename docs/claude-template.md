# CLAUDE.md Template

vibecheck includes a prompt-level enforcement layer for AI agents. The CLAUDE.md template instructs agents to follow the two-phase protocol and write strong assertions.

This is the "soft" layer — it aligns agent behavior with the structural checks. An agent that follows these instructions will naturally produce code that passes vibecheck. An agent that ignores them will be caught by mutation testing and semantic diff analysis.

## The Template

Add this to your project's `CLAUDE.md` (or equivalent agent instruction file):

```markdown
## Test Integrity Protocol

This project uses vibecheck to measure test quality, not just test existence.

Your tests will be evaluated by:
1. **Mutation testing** — Stryker will mutate the source code and check
   if your tests catch the mutations. Weak assertions like `toBeDefined()`
   will fail. Write precise assertions.
2. **Hidden tests** — A separate test suite you cannot see will run against
   your implementation. Write code that satisfies the spec, not just the
   visible tests.
3. **Property-based tests** — Core modules require fast-check property tests.
   Write invariants, not just examples.
4. **Semantic analysis** — If you weaken an existing assertion, the CI will
   flag it.

Guidelines:
- Prefer `toBe` / `toEqual` / `toStrictEqual` over `toBeDefined` / `toBeTruthy`
- Write property-based tests for pure functions and data transformations
- Include edge cases: empty inputs, boundary values, error conditions
- If a test seems wrong, flag it in a comment for human review — do not weaken it
- Do not add `.skip` to existing tests
- Do not reduce the number of assertions in a test block
- Write tests first, then implementation — never in the same commit
```

## How to Use

### Generate via CLI

```bash
npx vibecheck init
```

The init command prints the template to stdout. Append it to your existing CLAUDE.md:

```bash
npx vibecheck init 2>/dev/null | tail -n +3 >> CLAUDE.md
```

### Manual Installation

Copy the template above into your `CLAUDE.md` file. Adjust the guidelines based on which analyzers you have enabled.

## Why Prompt-Level Enforcement

Structural checks (mutation testing, semantic diff) catch bad output. Prompt instructions prevent bad output from being generated in the first place. Both layers are useful:

- **Without prompt instructions**: The agent writes weak tests, CI catches them, the agent rewrites. Multiple iterations wasted.
- **Without structural checks**: The agent follows instructions most of the time but occasionally takes shortcuts. No backstop.
- **Both together**: The agent writes strong tests on the first try. Structural checks verify. Minimal iteration.

## Adapting for Other Agents

The template works with any AI agent that reads instruction files:

- **Claude Code** — `CLAUDE.md`
- **GitHub Copilot** — `.github/copilot-instructions.md`
- **Cursor** — `.cursorrules`

Adjust the filename and formatting for your agent's convention. The content is agent-agnostic.
