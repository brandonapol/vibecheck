# CI Integration

vibecheck is designed to run in CI as the enforcement backstop. Pre-commit hooks are local safeguards that can be bypassed; CI cannot.

## GitHub Actions

### Using the Template

`vibecheck init` generates a workflow file if `.github/workflows/` exists. You can also create one manually:

```yaml
name: Vibecheck Test Integrity

on:
  pull_request:
    branches: [main]

jobs:
  vibecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # Required for semantic diff (needs git history)

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - run: npx vibecheck check --threshold 80 --base origin/${{ github.base_ref }}
```

### Reusable Workflow

vibecheck ships a reusable workflow template for organization-wide adoption:

```yaml
name: Vibecheck

on:
  pull_request:
    branches: [main]

jobs:
  vibecheck:
    uses: your-org/vibecheck/.github/workflows/vibecheck.yml@main
    with:
      protected-branch: main
      threshold: 80
      node-version: '20'
```

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `protected-branch` | `string` | `'main'` | Branch to compare for semantic diff |
| `threshold` | `number` | `80` | Minimum composite integrity score. The mutation score is gated separately by `mutation.threshold` in `vibecheck.config.ts`. |
| `node-version` | `string` | `'20'` | Node.js version |

#### Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `hidden-tests-deploy-key` | No | SSH deploy key for private hidden tests repo |

### Branch Protection

## Config Comes From the Base Branch

In CI (whenever the `CI` environment variable is set, as it is on GitHub Actions), or whenever `--base <ref>` is passed, `vibecheck check` reads `vibecheck.config.ts` from the base ref with `git show`, not from the working tree. The PR's own config isn't trusted. It's compared against the base config, and any weakening fails the check: a lowered threshold, a disabled analyzer, a new exclude, a dropped language, a repointed `protectedBranch`, and so on. A PR that only strengthens the config passes, and the stronger settings apply once it merges.

- Pass `--base origin/${{ github.base_ref }}`. Without it, the ref defaults to `origin/<protectedBranch>`, and `protectedBranch` is read from the PR's own config. Changing it is reported, but it's better not to depend on it.
- Check out with `fetch-depth: 0`. If the base ref can't be read, the check fails rather than falling back to the PR's config.
- If the base branch has no `vibecheck.config.ts`, the defaults apply.

Outside CI, with no `--base`, the working-tree config is used, so you can try config changes locally.

### What this can't cover

The workflow file is on the PR branch too. A PR can edit `.github/workflows/vibecheck.yml` to skip the step, drop `--base`, or lower `--threshold`. Close that gap in GitHub, not in vibecheck:

- [ ] Make the vibecheck job a **required status check** in branch protection (or a ruleset), so it can't just disappear.
- [ ] Add **CODEOWNERS** entries so changes to `.github/workflows/` and `vibecheck.config.ts` need review from a human owner:
  ```
  /.github/workflows/   @your-org/maintainers
  /vibecheck.config.ts  @your-org/maintainers
  ```
- [ ] Turn on **Require review from Code Owners** for the protected branch.

For maximum enforcement, configure GitHub branch protection to require the vibecheck check to pass before merging:

1. Go to **Settings > Branches > Branch protection rules**
2. Add a rule for `main`
3. Enable **Require status checks to pass before merging**
4. Search for and add the vibecheck job name

## fetch-depth: 0

!!! important
    The `fetch-depth: 0` option on `actions/checkout` is required. Without it, the checkout is shallow and vibecheck can't compare against the base branch for semantic diff analysis.
