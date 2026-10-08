# Mutation Testing

Mutation testing is the strongest single signal for test quality. It works by making small changes (mutations) to your source code and checking whether your tests catch them. If a test suite passes despite a mutation, the tests are too weak.

## How It Works

1. vibecheck runs [Stryker](https://stryker-mutator.io/) against your source files
2. Stryker creates mutations: replacing `+` with `-`, `true` with `false`, removing function calls, etc.
3. Your tests run against each mutant
4. **Killed mutants** = tests caught the change (good)
5. **Surviving mutants** = tests didn't notice (bad)

The mutation score is `killed / (killed + survived + uncovered) * 100`.

A mutant counts as **killed** when the tests did not pass, including a timeout. **Survived** means the tests passed anyway. **Uncovered** means nothing executed the mutant: an uncovered line an agent just added is the case this gate exists for, so it counts against the score. Mutants that did not compile, or were not executed, are ignored and do not change the score. A pending or unknown status is an error, not a kill. The same rule is applied to Stryker and to gremlins. It is not gremlins' own efficacy (`KILLED / (KILLED + LIVED)`), which ignores uncovered code.

An empty run (nothing to mutate) scores 100. A run that produced mutants but none of them were killed, survived, or uncovered — every one skipped or not viable — throws, rather than scoring 100.

## Installing Stryker

vibecheck runs the `stryker` binary in the project's `node_modules/.bin`. It does not call `npx stryker`: with nothing installed locally, that name resolves to the abandoned `stryker@1.0.1` package, not mutation testing.

```bash
npm install --save-dev @stryker-mutator/core @stryker-mutator/vitest-runner
```

If the binary is missing, `vibecheck check --mutation` fails. It does not report a score of 100.

`src/analyzers/mutation.real.test.ts` runs that binary against `test/fixtures/stryker`. The test is skipped when `node_modules/.bin/stryker` is not installed there, and when the installed binary refuses to start (Stryker 10 requires Node.js 22 or newer). CI installs the fixture on Node 22 only. Those dev dependencies are not dependencies of vibecheck. A `npx` earlier on `PATH` exits 97, so a runner that shells out to `npx stryker` fails the test.

The JSON report is read from `jsonReporter.fileName` in `stryker.config.json` (or `stryker.conf.json`). When that file does not set one, vibecheck reads Stryker's default, `reports/mutation/mutation.json`. A JavaScript config's custom path is not evaluated.

## Why It Catches Agents

An agent that writes `expect(result).toBeDefined()` will get a low mutation score because the assertion passes regardless of what `result` actually contains. The agent would need to write `expect(result).toBe(42)` to kill the mutants.

## Configuration

```typescript
mutation: {
  enabled: true,
  tool: 'stryker',
  threshold: 80,          // Fail if overall score is below this
  perFileThreshold: 60,   // Fail if any single file is below this
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.d.ts'],
}
```

## Example Output

```
Mutation Score: 82% (threshold: 80)

Surviving mutants:
  src/core/calculator.ts:42 — ArithmeticOperator: replaced + with -
  src/core/calculator.ts:58 — ConditionalExpression: replaced > with >=
```

A diff-scoped run (CI only; see below) is marked, because that score is not comparable to a full one:

```
Mutation Score: 82% (threshold: 80, diff-scoped)
```

Each surviving mutant tells you exactly where your tests are weak: line number, mutation type, and what was changed. gremlins does not report the replacement text, so the status (`LIVED`, `NOT COVERED`) is shown in its place.

## Thresholds

- **`threshold`** (default: 80) — minimum overall mutation score across all files
- **`perFileThreshold`** (default: 60) — minimum score for any individual file, prevents agents from concentrating weak tests in a few files while keeping the average high

## Limitations

Mutation testing is computationally expensive. A large codebase can take minutes to test. Use the `include` and `exclude` patterns to scope it to critical code paths. A TypeScript run passes them to Stryker as `--mutate` (`include` entries, then `!exclude` entries). An empty `include` mutates nothing. A `languages.typescript.mutation` include or exclude replaces the top-level list for that run. Go already applied its own globs.

An agent can still game mutation testing by writing tests that are technically precise but only cover happy paths. That's why vibecheck combines it with other analyzers.

## Go (gremlins)

For Go, `languages.go` runs [gremlins](https://github.com/go-gremlins/gremlins) v0.6.0 (`gremlins unleash`). gremlins is not a dependency of vibecheck and it is not installed by `npm install`. It has to be on `PATH`:

```bash
go install github.com/go-gremlins/gremlins/cmd/gremlins@v0.6.0
```

`languages.go.mutation.enabled` defaults to true, so listing `go: {}` runs gremlins. If the binary is missing, `vibecheck check` fails. It does not report a score of 100. Set `mutation.enabled` to false to analyze Go tests without mutation testing.

vibecheck always passes `--config` pointing at a file it just wrote, with gremlins' efficacy and mutant-coverage thresholds at 0 and with no excludes. A project `.gremlins.yaml` is not loaded: that file can turn mutators off or set a threshold, which would let an agent relax the gate. `GREMLINS_*` environment variables are stripped from the gremlins process for the same reason. vibecheck's `threshold` and `perFileThreshold` are the only gate. gremlins' own `--threshold-efficacy` and `--threshold-mcover` are left unset.

Status mapping:

| gremlins | score |
|----------|--------|
| `KILLED`, `TIMED OUT` | killed |
| `LIVED` | survived |
| `NOT COVERED` | uncovered (counts against) |
| `NOT VIABLE`, `SKIPPED` | ignored |
| `RUNNABLE` | error (a dry-run is not a result) |

Include paths with no glob (`pkg/math`, `internal/calc`) each get their own `gremlins unleash <package>`. A glob (the default `**/*.go`) is one run of the module, then the report is filtered. `*_test.go` is always dropped. Exclude globs are applied to the report rather than handed to gremlins as regular expressions.

On a pull request (`CI` is set), vibecheck passes `--diff origin/$GITHUB_BASE_REF`, or `origin/<protectedBranch>` when the base ref is not set, and the report is marked `diffScoped`. Local runs mutate the whole module. A diff-scoped score only describes the changed lines, so it is not comparable to a full run.

## Dart (mutation_test)

For Dart, `languages.dart` runs [`mutation_test`](https://pub.dev/packages/mutation_test) 1.8.1 (`dart run mutation_test`). It is not an npm dependency. The package under test needs it as a dev dependency (`mutation_test: 1.8.1`), and `dart` has to be on `PATH`. `languages.dart.mutation.enabled` defaults to true, so listing `dart: {}` runs it. A missing SDK, a failed run with no xunit report, or a report vibecheck cannot parse fails the check. None of those is a score of 100.

vibecheck writes the rules and the input document itself and passes `--rules`. That disables the builtin rules. The rules cover arithmetic, comparison, boolean, and numeric `return` mutations. `return null` is not one of them, because null safety makes it fail to compile. The input document sets `failure="0"`, so mutation_test's own threshold does not decide the run. vibecheck's `threshold` and `perFileThreshold` are the only gate. The report format is xunit.

The default include is `lib/**/*.dart`. `*_test.dart` and anything under a `test` directory are never mutated, so Flutter widget tests are not the mutation targets. Add a path to `languages.dart.mutation.include` to mutate a Dart file outside `lib`.

mutation_test has no diff flag. On a pull request (`CI` is set), vibecheck lists `git diff --name-only --no-renames origin/$GITHUB_BASE_REF HEAD` (or `origin/<protectedBranch>`) and mutates only the selected Dart files. The report is marked `diffScoped`. If none of those files are Dart sources, the score is 100 and the tool is not run. Local runs mutate every selected file.

| xunit | score |
|-------|--------|
| testcase with no failure or error | killed |
| `<error type="timeout">` | killed |
| `<failure type="undetected">` | survived |
| `<error type="not covered by tests">` | uncovered (counts against) |
| any other failure or error | error (not a score) |
