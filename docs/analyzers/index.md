# Analyzers

vibecheck uses multiple analyzers that each target a different class of test evasion. No single analyzer is sufficient on its own — agents can game any individual check. The combination makes evasion structurally difficult.

## Analyzer Summary

| Analyzer | Evasion it catches | Default weight | Status |
|----------|-------------------|----------------|--------|
| [Mutation Testing](mutation.md) | Weak assertions that don't catch code changes | 40% | Implemented |
| [Semantic Diff](semantic-diff.md) | Retroactive assertion weakening between commits | 10% | Implemented |
| [Config Weakening](config-weakening.md) | Threshold reductions and analyzer disabling | n/a | Implemented |
| Hidden Tests | Tests fitted to implementation instead of spec | 30% | Planned |
| Property Tests | Hardcoded return values that pass example-based tests | 20% | Planned |

## How They Compose

Each analyzer produces a score from 0-100. These are combined into a weighted average:

```
total = (mutation * 0.40 + semanticDiff * 0.10 + hidden * 0.30 + property * 0.20)
```

Disabled analyzers are excluded from both the numerator and denominator, so enabling fewer analyzers doesn't inflate the score. If all analyzers are disabled, the score is 0 (not 100).

## Defense in Depth

The key insight is that each analyzer covers a different attack surface:

- **Mutation testing** catches agents that write tests which *look* right but don't actually verify behavior (e.g., `expect(result).toBeDefined()` instead of `expect(result).toBe(42)`)
- **Semantic diff** catches agents that start with strong tests and weaken them after the fact
- **Hidden tests** catch agents that write implementation fitted to visible tests rather than the actual spec
- **Property tests** catch agents that hardcode return values for specific inputs

An agent would need to simultaneously satisfy all four to pass, which requires genuinely correct code.
