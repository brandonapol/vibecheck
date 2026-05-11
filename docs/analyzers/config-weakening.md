# Config Weakening Detection

The config weakening analyzer compares a before and after version of `vibecheck.config.ts` to detect attempts to lower thresholds, disable analyzers, or otherwise reduce enforcement.

## Why This Exists

An AI agent with write access to `vibecheck.config.ts` could:

- Lower `mutation.threshold` from 80 to 10
- Set `semanticDiff.enabled` to `false`
- Downgrade `enforcement` from `'block'` to `'warn'`
- Add critical source files to the `exclude` list
- Remove files from the `include` list

This effectively disarms vibecheck without modifying any test code. The config weakening analyzer catches these changes.

## What It Detects

| Change | Example |
|--------|---------|
| Threshold reduction | `threshold: 80` to `threshold: 50` |
| Per-file threshold reduction | `perFileThreshold: 60` to `perFileThreshold: 20` |
| Analyzer disabled | `enabled: true` to `enabled: false` |
| Enforcement downgrade | `'block'` to `'warn'` or `'comment'` |
| Exclude list expansion | Adding entries to `mutation.exclude` |
| Include list shrinkage | Removing entries from `mutation.include` |

## What It Allows

Strengthening changes are always allowed:

- Raising thresholds
- Enabling analyzers
- Upgrading enforcement from `'warn'` to `'block'`
- Narrowing exclude lists
- Expanding include lists

## Pre-commit Protection

The pre-commit hook adds a second layer: it blocks commits that modify `vibecheck.config.ts` alongside implementation files. Config changes must be committed separately so they get proper human review.

```
vibecheck: Config protection violation

  Config files must be committed separately from implementation files.
  Config changes should be reviewed independently.

  Config files staged:
    vibecheck.config.ts

  Implementation files staged:
    src/feature.ts
```

Config changes alongside test files are allowed, since test and config changes often go together legitimately.
