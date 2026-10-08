# CI Integration

vibecheck is designed to run in CI as the enforcement backstop. Pre-commit hooks are local safeguards that can be bypassed; CI cannot. What has to be true of the repository for that backstop to hold is in [Threat model](threat-model.md).

This repository runs that backstop on itself. The Dogfood job builds this checkout and runs `node dist/bin/vibecheck.js check --semantic` against the base ref. Mutation stays out of that job. The same job then compiles `helpers/go-testast` when `go` is already on the runner, and runs `npx vitest run --coverage`. That compile fills the Go build cache; a cold build of the parser is slower than the test timeout. `vitest.config.ts` sets line, statement, function, and branch floors for `src/**/*.ts` with `all: true`, so an untested source file fails the job. On GitHub Actions, each check failure is also printed as a `::error::` annotation. A ShiftLeft job scans the same commits with `ShiftLeftSecurity/scan-action` (`nodejs`, `go`, `credscan`, `depscan`). That action passes `--no-error`, so findings are reported and do not fail the job. An edit to any `.github/workflows/*.yml` file is reported as workflow drift and does not, by itself, fail the check.

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
| `hidden-tests-deploy-key` | No | SSH private key for `hiddenTests.source: 'repo'`. The workflow writes it to `VIBECHECK_HIDDEN_TESTS_KEY` when the secret is non-empty. |

## GitLab CI

`templates/gitlab-ci.yml` is the GitLab equivalent of the GitHub Actions workflow. It is an include, not a copy of your whole pipeline. `vibecheck init` copies it to `.gitlab/vibecheck.yml` when `.gitlab-ci.yml` already exists, and does not rewrite that file.

```yaml
include:
  - local: .gitlab/vibecheck.yml
```

To include the copy that ships with vibecheck:

```yaml
include:
  - remote: https://raw.githubusercontent.com/brandonapol/vibecheck/main/templates/gitlab-ci.yml

vibecheck:
  extends: .vibecheck
  variables:
    VIBECHECK_THRESHOLD: "90"
```

The job clones with `GIT_DEPTH: "0"`, fetches the merge request's target branch, and runs:

```bash
npx vibecheck check --threshold "$VIBECHECK_THRESHOLD" --base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
```

On a branch pipeline that is not a merge request, the base is `origin/$CI_DEFAULT_BRANCH`.

For `hiddenTests.source: 'repo'`, define `VIBECHECK_HIDDEN_TESTS_KEY` as a [file variable](https://docs.gitlab.com/ci/variables/#use-file-type-cicd-variables). vibecheck reads that variable itself. The template does not print the key.

The same limits as GitHub apply: a merge request can edit `.gitlab-ci.yml` and drop the include. Protect that file with CODEOWNERS, and require the `vibecheck` job to pass before merge.

### Branch Protection

## Config Comes From the Base Branch

In CI (whenever the `CI` environment variable is set, as it is on GitHub Actions), or whenever `--base <ref>` is passed, `vibecheck check` reads `vibecheck.config.ts` from the base ref with `git show`, not from the working tree. The PR's own config isn't trusted. It's compared against the base config, and any weakening fails the check: a lowered threshold, a disabled analyzer, a new exclude, a dropped language, a repointed `protectedBranch`, and so on. A PR that only strengthens the config passes, and the stronger settings apply once it merges.

- Pass `--base origin/${{ github.base_ref }}`. Without it, the ref defaults to `origin/<protectedBranch>`, and `protectedBranch` is read from the PR's own config. Changing it is reported, but it's better not to depend on it.
- Check out with `fetch-depth: 0`. If the base ref can't be read, the check fails rather than falling back to the PR's config.
- If the base branch has no `vibecheck.config.ts`, the defaults apply.

Outside CI, with no `--base`, the working-tree config is used, so you can try config changes locally.

### Which snapshot is audited

In CI the file list is `git diff --name-only <base> HEAD` and contents are read from `HEAD`. A dirty worktree on the runner cannot hide a weakening or invent one. Locally, `vibecheck check` diffs and reads the working tree, which is the edit about to be committed. `vibecheck check --hook` does not run semantic diff; it only looks at what is staged.

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
