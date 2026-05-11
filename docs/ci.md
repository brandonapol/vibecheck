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

      - run: npx vibecheck check --threshold 80
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
      mutation-threshold: 80
      node-version: '20'
```

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `protected-branch` | `string` | `'main'` | Branch to compare for semantic diff |
| `mutation-threshold` | `number` | `80` | Minimum mutation score |
| `node-version` | `string` | `'20'` | Node.js version |

#### Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `hidden-tests-deploy-key` | No | SSH deploy key for private hidden tests repo |

### Branch Protection

For maximum enforcement, configure GitHub branch protection to require the vibecheck check to pass before merging:

1. Go to **Settings > Branches > Branch protection rules**
2. Add a rule for `main`
3. Enable **Require status checks to pass before merging**
4. Search for and add the vibecheck job name

## fetch-depth: 0

!!! important
    The `fetch-depth: 0` option on `actions/checkout` is required. Without it, the checkout is shallow and vibecheck can't compare against the base branch for semantic diff analysis.
