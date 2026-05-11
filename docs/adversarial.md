# Adversarial Testing

vibecheck is adversarially tested against the very attacks it's designed to prevent. This page documents the attack vectors we've tested, which ones are caught, and which remain as known limitations.

## Philosophy

If you're building a tool to catch AI agents gaming tests, you need to verify it by trying to game it yourself. Every loophole documented here was discovered through systematic adversarial testing and either fixed or acknowledged as a known limitation.

The adversarial test suites live in `test/adversarial/` and serve as living documentation of the threat model.

## Semantic Diff Evasion

Attacks against the assertion weakening detector.

### Caught

| Attack | How it works | Defense |
|--------|-------------|---------|
| **Gut test body** | Replace strong assertions with weak ones, same test name | Positional assertion strength comparison |
| **Pad with weak assertions** | Remove strong assertion, add weak ones to maintain count | Position-level comparison catches weakening at each index |
| **Untracked assertion methods** | Use methods not in the strength map | 31 methods tracked, covering all standard vitest/jest matchers |
| **Comment out assertions** | Comment out `expect()` instead of using `.skip` | Comments stripped before assertion extraction |
| **Tautological assertions** | Replace real assertions with `expect(true).toBe(true)` | Tautology pattern detection |
| **Template literal expressions** | Use `` `${var}` `` in test names to break regex | Brace scanning starts after regex match, skipping name content |
| **Move between describe blocks** | Move test to different describe block with weaker assertions | Name-based matching is context-independent |
| **Test rename with weakening** | Rename test and weaken assertions | `weak-new-test` detection flags new tests with only low-strength assertions |
| **Brand new weak tests** | Write weak tests from scratch (no before to compare) | `weak-new-test` detection flags tests below strength threshold |

### Known Limitations

| Attack | How it works | Why it's hard to fix |
|--------|-------------|---------------------|
| **Dynamic method calls** | `expect(result)[method]()` where method is a variable | Would require runtime analysis, not static regex |
| **`it.each` replacement** | Replace individual tests with weak `it.each` | Deletions are flagged, but the replacement's weakness is not compared against the originals |

## Pre-commit Hook Evasion

Attacks against the two-phase commit enforcement.

### Caught

| Attack | How it works | Defense |
|--------|-------------|---------|
| **`.tsx` test files** | Use `.tsx` extension for tests | Hook checks `.ts`, `.tsx`, `.js`, `.jsx` |
| **Modified test + new impl** | Modify existing test and add new impl file | Hook blocks any mix of test + impl files |
| **Config alongside impl** | Sneak config threshold changes alongside implementation | Config protection blocks config + impl commits |
| **`__tests__/` directory** | Files in `__tests__/` directories | Hook recognizes `__tests__/*` as test files |

### Known Limitations

| Attack | How it works | Why it's hard to fix |
|--------|-------------|---------------------|
| **`--no-verify`** | `git commit --no-verify` bypasses all hooks | Fundamental git limitation. CI backstop catches this. |
| **Non-standard naming** | Test logic in `.json` fixtures | Would require content analysis, not just filename matching |

## Score Gaming

Attacks against the composite integrity score.

### Caught

| Attack | How it works | Defense |
|--------|-------------|---------|
| **Disable all analyzers** | Set all analyzers to `enabled: false` | Score returns 0 when no analyzers are enabled |
| **Config threshold reduction** | Lower `mutation.threshold` in config | Config weakening analyzer detects threshold reductions |
| **Analyzer disabling** | Set `enabled: false` on specific analyzers | Config weakening analyzer detects disabling |
| **Enforcement downgrade** | Change `'block'` to `'warn'` | Config weakening analyzer detects downgrades |

### Known Limitations

| Attack | How it works | Why it's hard to fix |
|--------|-------------|---------------------|
| **Semantic diff weight** | At 10% weight, even 100% weakening only costs 10 points | By design — semantic diff is supplementary. Mutation testing (40%) is the primary signal. |
| **Single analyzer inflation** | Enable only semantic diff (no violations = 100%) | Config protection prevents disabling analyzers. If an agent has pre-existing config access, this is a process issue. |

## Running the Adversarial Tests

```bash
npx vitest run test/adversarial/
```

Tests marked `FIXED` verify that a previously-working attack is now caught. Tests marked `LOOPHOLE` document known limitations. Tests marked `DESIGN FLAW` document fundamental architectural constraints.
