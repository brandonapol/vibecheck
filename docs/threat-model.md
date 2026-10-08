# Threat model

vibecheck has two kinds of control, and only one of them is enforcement.

## Trust boundary

Anything that runs on the agent's machine is a **guardrail**. That includes the git hook, `vibecheck.config.ts` in the working tree, the CLI binary the agent installed, and a Claude Code or Cursor settings hook. Guardrails give a cooperative agent fast feedback. They are not a guarantee. Each of these is one command away:

- `git commit --no-verify`
- `chmod -x .git/hooks/pre-commit`, or editing the hook
- `git config core.hooksPath` pointing somewhere else
- Changing `vibecheck.config.ts` on the branch under review, if CI reads that copy

The **enforcement** layer is the protected branch's CI, plus the repository settings that make that CI unavoidable. An agent that can push to the protected branch, or turn the check off, is outside the boundary this tool can defend.

## Enforcement checklist

For a downstream repo, all of these:

- Branch protection on the protected branch: no force-push, no deletion, and no admin bypass that the agent's token has.
- `vibecheck` as a required status check. A workflow that runs but is not required does not block the merge.
- CODEOWNERS, with a human owner, on `.github/workflows/`, `vibecheck.config.ts`, and (if you want a second pair of eyes) the protected test directories.
- CI checks the config from the base branch, not the PR head. `vibecheck check` does this when `CI` is set or `--base` is passed. The head config is only compared for weakening.
- The agent has no repository admin and cannot approve its own pull requests.

## What each layer stops

| Layer | Stops | Does not stop |
|-------|--------|----------------|
| Tool hook (editor `PreToolUse`, when you add one) | An edit to a protected test before it is written | A different tool, a raw shell, or a setting the agent can edit |
| Git hook | A mixed or protected-test commit, for an agent that actually runs hooks | `--no-verify`, a replaced `hooksPath`, a commit made outside this clone |
| CI on the protected branch | A merge of weakened assertions, a weakened config, a dropped test, a regenerated golden | A branch that never opens a PR, or a repo where the check is not required |

Local `npx vibecheck check` is the same program CI runs, but the result on a laptop is advice. The result as a required status check is the gate.

## What "fail closed" means here

A git error, a missing toolchain, or an unparsable file is a failed check, not a pass. Treating "could not read `origin/main`" as "no files changed" would unprotect every test the moment the clone is shallow or the remote is unnamed. The analyzers refuse that.
