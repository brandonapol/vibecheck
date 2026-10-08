#!/usr/bin/env node

import { parseArgs } from '../src/cli/commands.js'
import { runCheck } from '../src/cli/runner.js'
import { scaffoldProject } from '../src/cli/init.js'
import { loadConfig } from '../src/config/loader.js'
import { resolveCheckConfig } from '../src/cli/config-source.js'
import { checkProtectedTests, isProtectedTestFile, type ProtectedTestViolation } from '../src/analyzers/protected-tests.js'
import { detectWeakeningWithAdapter, type WeakeningViolation } from '../src/analyzers/semantic-diff.js'
import {
  detectGoldenUpdates,
  extraGoldenTestFiles,
  resolveRelatedFile,
  type GoldenSide,
} from '../src/analyzers/golden-diff.js'
import type { ExtractedTest } from '../src/analyzers/test-ast.js'
import type { MutationReport } from '../src/analyzers/mutation.js'
import { runMutationForLanguages } from '../src/languages/mutation.js'
import { languageForFile, resolveLanguages } from '../src/languages/registry.js'
import { getChangedFiles, getFileAtRef, listWorktreeFilesContaining } from '../src/cli/worktree.js'
import { runInstalledHook } from '../src/hooks/pre-commit.js'
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
  --threshold <n>       Override the composite score threshold (0-100)
  --base <ref>          Check against the config at <ref> (default in CI: origin/<protectedBranch>)
  --hook                Pre-commit mode: staged files and enforcement only`

function goldenSides(tests: ExtractedTest[], file: string): GoldenSide[] {
  return tests.map(test => ({
    id: test.id,
    assertionKeys: test.assertions.map(assertion => assertion.key).sort(),
    bodyKey: test.bodyKey,
    relatedFiles: (test.relatedFiles ?? []).map(raw => resolveRelatedFile(file, raw)),
  }))
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

    if (result.hook.action === 'created') {
      console.log(`Installed ${result.hook.path}`)
    } else if (result.hook.action === 'appended') {
      console.log(`Appended vibecheck to ${result.hook.path}`)
    } else if (result.hook.action === 'skipped') {
      console.log('Skipped the git hook (not a git repository, and Husky is not installed)')
    }

    console.log('\nAdd this to your CLAUDE.md:\n')
    console.log(result.claudeSnippet)
    process.exit(0)
  }

  const headConfig = await loadConfig()

  if (parsed.flags.hook) {
    const result = await runInstalledHook(headConfig)
    if (result.message) console.log(result.message)
    process.exit(result.exitCode)
  }

  if (parsed.command === 'check' || parsed.command === 'score' || parsed.command === 'report') {
    const resolved = await resolveCheckConfig({ head: headConfig, env: process.env, baseRef: parsed.flags.base })
    const config = resolved.config
    const compareRef = resolved.baseRef ?? config.protectedBranch
    let mutationScore = 100
    let mutationReport: MutationReport | undefined = undefined
    const semanticViolations: WeakeningViolation[] = []

    const runMutation = parsed.flags.mutation || (!parsed.flags.semantic && config.mutation.enabled)
    const runSemantic = parsed.flags.semantic || (!parsed.flags.mutation && config.semanticDiff.enabled)

    if (runMutation) {
      try {
        mutationReport = await runMutationForLanguages(config)
        mutationScore = mutationReport.overallScore
      } catch (err) {
        console.error('Mutation analysis failed:', (err as Error).message)
        process.exit(1)
      }
    }

    // Protected tests are diffed even when semantic diff is off or not asked for.
    const { files: protectedFiles, required } = config.protectedTests
    const checkProtected = !parsed.flags.mutation && protectedFiles.length + required.length > 0
    const changedFiles = runSemantic || checkProtected ? await getChangedFiles(compareRef) : []
    let protectedViolations: ProtectedTestViolation[] = []

    if (runSemantic || checkProtected) {
      const languages = resolveLanguages(config)
      const files = [...changedFiles]
      if (runSemantic && changedFiles.some(file => /\.(png|gif|jpe?g|webp)$/i.test(file))) {
        const hits = await listWorktreeFilesContaining('matchesGoldenFile')
        files.push(...extraGoldenTestFiles(changedFiles, hits))
      }
      for (const file of files) {
        if (!runSemantic && !isProtectedTestFile(file, config)) continue
        const language = languageForFile(file, languages)
        if (!language) continue
        const before = await getFileAtRef(file, compareRef)
        const after = await readFile(file, 'utf-8').catch(() => '')
        if (before && after) {
          semanticViolations.push(...(await detectWeakeningWithAdapter(before, after, file, language.adapter)))
          if (runSemantic) {
            const [beforeTests, afterTests] = await Promise.all([
              language.adapter.extractTests(before, file),
              language.adapter.extractTests(after, file),
            ])
            semanticViolations.push(...detectGoldenUpdates({
              file,
              before: goldenSides(beforeTests, file),
              after: goldenSides(afterTests, file),
              changedFiles,
            }))
          }
        }
      }
    }

    if (checkProtected) {
      protectedViolations = await checkProtectedTests({
        config,
        changedFiles,
        semanticViolations,
        readBase: async file => (await getFileAtRef(file, compareRef)) || null,
        readHead: async file => readFile(file, 'utf-8').catch(() => null),
      })
    }

    const effectiveConfig = parsed.flags.threshold !== undefined ? { ...config, threshold: parsed.flags.threshold } : config

    const result = await runCheck(effectiveConfig, {
      mutationScore,
      mutationReport,
      semanticViolations,
      configViolations: resolved.configViolations,
      protectedViolations,
      ran: { mutation: runMutation, semanticDiff: runSemantic },
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
