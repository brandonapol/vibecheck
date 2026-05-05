#!/usr/bin/env node

import { parseArgs } from '../src/cli/commands.js'
import { runCheck } from '../src/cli/runner.js'
import { scaffoldProject } from '../src/cli/init.js'
import { loadConfig } from '../src/config/loader.js'
import { runMutationAnalysis } from '../src/analyzers/mutation.js'
import { detectWeakeningInDiff } from '../src/analyzers/semantic-diff.js'
import { execa } from 'execa'
import { readFile } from 'node:fs/promises'

const USAGE = `Usage: vibecheck <command> [options]

Commands:
  init                  Initialize vibecheck in your project
  check                 Run all enabled analyzers and report results
  score                 Output composite integrity score (0-100)
  report                Generate full integrity report

Options:
  --mutation            Run mutation analysis only
  --semantic            Run semantic diff only
  --threshold <n>       Override score threshold (0-100)`

async function getChangedTestFiles(baseBranch: string): Promise<string[]> {
  try {
    const { stdout } = await execa('git', ['diff', '--name-only', baseBranch, '--', '**/*.test.ts', '**/*.spec.ts'])
    return stdout.split('\n').filter(Boolean)
  } catch {
    return []
  }
}

async function getFileContent(file: string, branch: string): Promise<string> {
  try {
    const { stdout } = await execa('git', ['show', `${branch}:${file}`])
    return stdout
  } catch {
    return ''
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))

  if (parsed.command === 'help') {
    console.log(USAGE)
    process.exit(0)
  }

  if (parsed.command === 'init') {
    const result = await scaffoldProject(process.cwd())

    if (result.configCreated) {
      console.log('Created vibecheck.config.ts')
    } else {
      console.log('vibecheck.config.ts already exists, skipping')
    }

    if (result.hiddenDirCreated) {
      console.log('Created .vibecheck-hidden/ directory')
    }

    if (result.ciCreated) {
      console.log('Added .github/workflows/vibecheck.yml')
    }

    console.log('\nAdd this to your CLAUDE.md:\n')
    console.log(result.claudeSnippet)
    process.exit(0)
  }

  const config = await loadConfig()

  if (parsed.command === 'check' || parsed.command === 'score' || parsed.command === 'report') {
    let mutationScore = 100
    let mutationReport = undefined
    let semanticViolations: Awaited<ReturnType<typeof detectWeakeningInDiff>> = []

    const runMutation = parsed.flags.mutation || (!parsed.flags.semantic && config.mutation.enabled)
    const runSemantic = parsed.flags.semantic || (!parsed.flags.mutation && config.semanticDiff.enabled)

    if (runMutation) {
      try {
        mutationReport = await runMutationAnalysis(config.mutation)
        mutationScore = mutationReport.overallScore
      } catch (err) {
        console.error('Mutation analysis failed:', (err as Error).message)
        process.exit(1)
      }
    }

    if (runSemantic) {
      const changedFiles = await getChangedTestFiles(config.protectedBranch)
      for (const file of changedFiles) {
        const before = await getFileContent(file, config.protectedBranch)
        const after = await readFile(file, 'utf-8').catch(() => '')
        if (before && after) {
          semanticViolations.push(...detectWeakeningInDiff(before, after, file))
        }
      }
    }

    const effectiveConfig = parsed.flags.threshold
      ? { ...config, mutation: { ...config.mutation, threshold: parsed.flags.threshold } }
      : config

    const result = await runCheck(effectiveConfig, {
      mutationScore,
      mutationReport,
      semanticViolations,
    })

    if (parsed.command === 'score') {
      console.log(result.score.total)
    } else {
      console.log(result.report)
    }

    process.exit(result.pass ? 0 : 1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
