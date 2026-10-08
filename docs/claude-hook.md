# Claude Code edit hook

A git hook runs after the agent has already written the file. Claude Code can run a command *before* `Edit` or `Write`, and there is no `--no-verify` for that. vibecheck ships a template for it.

This is still a guardrail. The agent may be able to edit `.claude/settings.json` or the hook script. The protected branch's required CI check is what actually stops the merge. See [Threat model](threat-model.md).

## What it does

On `Edit`, `Write`, and `MultiEdit`, the hook reads the tool's `file_path` and runs:

```bash
npx --no-install vibecheck protected --file <path>
```

Exit 0 lets the edit through (not a test, or a test that is not on the protected branch yet). Exit 2 blocks it. The message tells the agent the file exists on the protected branch.

## Install

`vibecheck init` writes `.claude/hooks/vibecheck-protected.sh` and `.claude/settings.json` when `.claude/` already exists and `settings.json` does not. If settings already exist, init leaves them alone and prints where the snippet is.

The files are also in `templates/claude-protected.sh` and `templates/claude-settings.json`.

## Layers

| When | What | Stops an edit | Stops a merge |
|------|------|----------------|---------------|
| Tool hook | Before the file is written | Yes, until the agent edits the hook | No |
| Git hook | `vibecheck check --hook` | A commit, until `--no-verify` | No |
| CI | Required status check, config from the base branch | No | Yes |
