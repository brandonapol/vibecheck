# Hidden tests

A hidden test is an assertion the agent cannot see, so it cannot weaken it or write the implementation to fit it. That is the point of the 30% weight: mutation and semantic diff both look at tests the agent can read.

Hidden tests are off until you enable them. When they are on, `vibecheck check`, `score`, and `report` run them. `vibecheck check --hook` does not. `--mutation` and `--semantic` skip them and the report shows `— (skipped)` instead of a perfect score.

## What runs

Vitest, and only the binary at `node_modules/.bin/vitest`. `npx vitest` is not used. A missing binary, a directory that is not there, a clone that fails, or a report that is not Vitest JSON fails the check. An empty suite is a pass rate of 0, not 100.

The project's Vitest `include` is replaced for this run, so a config that only lists `src/**/*.test.ts` still runs the holdout directory. Aliases and `setupFiles` from `vitest.config.ts` (or `vite.config.ts`) are kept. The root of that run is the project, not a parent of it.

vibecheck does not rewrite imports. A file in the holdout directory imports the implementation the same way any test in that directory would: a relative path (`../src/add.ts`) or the package name.

Skipped and `todo` tests are not passes. A file that fails to load counts as a failure.

## Directory

```typescript
hiddenTests: {
  enabled: true,
  source: 'directory',
  path: '.vibecheck-hidden', // must stay inside the project
  threshold: 100,            // pass rate below this fails when enforcement is block
  enforcement: 'block',      // 'block' | 'warn'
}
```

`vibecheck init` creates `.vibecheck-hidden/` and adds it to `.gitignore`, along with `.vibecheck-cache/`. The directory is yours to fill. If it is gitignored, the agent that only sees the checkout does not see the tests; CI has to be given the files some other way (a private repo is the usual way).

A pass rate under `threshold` fails the check when `enforcement` is `block`, even if the composite score is still above its own threshold. `warn` records the rate and does not fail on it.

## Private repo

```typescript
hiddenTests: {
  enabled: true,
  source: 'repo',
  url: 'git@github.com:org/hidden-tests.git',
  branch: 'main',
}
```

vibecheck clones that branch with `git clone --depth 1` into `.vibecheck-cache/hidden-tests`, runs the suite, and deletes the clone. The clone is inside the project so Node can resolve `node_modules` and relative imports. From a test file in that directory, `../../src/add.ts` is the project's `src/add.ts`.

The deploy key is `VIBECHECK_HIDDEN_TESTS_KEY`: a path to a private key, or the key text itself (`-----BEGIN ...`). The text is written to a file mode `0600` and deleted with the clone. It is not printed. The reusable workflow writes the `hidden-tests-deploy-key` secret to that variable before `vibecheck check`.

Changing the URL, the branch, the directory, or the source, lowering `threshold`, switching enforcement to `warn`, or disabling hidden tests is config weakening. Enabling them is not.

## What this does not do

Property tests are still not implemented. Hidden tests do not run Go or Dart suites. There is no import rewriter and no second package alias: if a test needs one, it has to live in the Vitest config the run already keeps.
