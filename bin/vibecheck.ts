#!/usr/bin/env node

import { parseArgs } from '../src/cli/commands.js'
import { runCheck } from '../src/cli/runner.js'
import { scaffoldProject } from '../src/cli/init.js'
import { loadConfig } from '../src/config/loader.js'
import { resolveCheckConfig } from '../src/cli/config-source.js'
import { checkProtectedTests, isProtectedTestFile, type ProtectedTestViolation } from '../src/analyzers/protected-tests.js'
import { detectAddedTestFile, detectWeakeningWithAdapter, semanticDiffSides, type WeakeningViolation } from '../src/analyzers/semantic-diff.js'
import { detectGoldenUpdates, extraGoldenTestFiles, resolveRelatedFile, type GoldenSide } from '../src/analyzers/golden-diff.js'
import { detectTamper, tamperCandidate, type TamperViolation } from '../src/analyzers/tamper.js'
import type { ExtractedTest } from '../src/analyzers/test-ast.js'
import type { MutationReport } from '../src/analyzers/mutation.js'
import { runMutationForLanguages } from '../src/languages/mutation.js'
import { languageForFile, resolveLanguages } from '../src/languages/registry.js'
import { auditTarget, getChangedFiles, getFileAtRef, listWorktreeFilesContaining, readAuditedFile } from '../src/cli/worktree.js'
import { runHiddenTests, type HiddenTestReport } from '../src/analyzers/hidden-tests.js'
import { runInstalledHook } from '../src/hooks/pre-commit.js'
import { runCommitMsgHook } from '../src/hooks/commit-msg.js'
import { auditRange, findAuditHits, formatAudit, loadAuditCommits } from '../src/cli/audit.js'
import { collectStatus, formatStatus } from '../src/cli/status.js'
import { protectedMessage, protectionFor } from '../src/cli/protected.js'
import { fileExistsInBranch } from '../src/core/resolver.js'
import { execa } from 'execa'

const USAGE = `Usage: vibecheck <command> [options]

Commands:
  init                  Initialize vibecheck in your project
  status                Show which test files are protected
  protected --file <p>  Exit 2 when <p> is a protected test
  commit-msg --file <p> Tag a commit message with the phase, when hooks.commitMsg is on
  audit                 Scan history for agent edits to existing tests
  check                 Run all enabled analyzers and report results
  score                 Output composite integrity score (0-100)
  report                Generate full integrity report

Options:
  --mutation            Run mutation analysis only
  --semantic            Run semantic diff only
  --threshold <n>       Override the composite score threshold (0-100)
  --base <ref>          Check against the config at <ref> (default in CI: origin/<protectedBranch>)
  --since <ref>         With audit, scan <ref>..HEAD instead of all of HEAD
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

    if (result.gitlabCiCreated) {
      console.log('Added .gitlab/vibecheck.yml')
      console.log('Include it from .gitlab-ci.yml:\n\ninclude:\n  - local: .gitlab/vibecheck.yml')
    }

    if (result.hook.action === 'created') {
      console.log(`Installed ${result.hook.path}`)
    } else if (result.hook.action === 'appended') {
      console.log(`Appended vibecheck to ${result.hook.path}`)
    } else if (result.hook.action === 'skipped') {
      console.log('Skipped the git hook (not a git repository, and Husky is not installed)')
    }

    if (result.claudeHook.action === 'installed') {
      console.log('Installed .claude/hooks/vibecheck-protected.sh and .claude/settings.json')
    } else if (result.claudeHook.action === 'snippet') {
      console.log('Claude Code settings already exist. Add the PreToolUse hook from templates/claude-settings.json (init will not rewrite settings.json).')
    } else if (result.claudeHook.action === 'unchanged') {
      console.log('Claude Code protected-test hook already configured')
    }

    console.log('\nAdd this to your CLAUDE.md:\n')
    console.log(result.claudeSnippet)
    process.exit(0)
  }

  if (parsed.command === 'status') {
    const config = await loadConfig()
    const { stdout } = await execa('git', ['ls-files', '-c', '-o', '--exclude-standard'])
    const files = stdout.split('\n').filter(Boolean)
    const status = await collectStatus(files, config.testPatterns, file => fileExistsInBranch(file, config.protectedBranch))
    console.log(formatStatus(status))
    process.exit(0)
  }

  if (parsed.command === 'protected') {
    if (!parsed.flags.file) {
      console.error('vibecheck protected requires --file <path>')
      process.exit(2)
    }
    const config = await loadConfig()
    const protection = await protectionFor(parsed.flags.file, config.testPatterns, file =>
      fileExistsInBranch(file, config.protectedBranch),
    )
    if (protection === 'protected') {
      console.error(protectedMessage(parsed.flags.file, config.protectedBranch))
      process.exit(2)
    }
    process.exit(0)
  }

  if (parsed.command === 'commit-msg') {
    if (!parsed.flags.file) {
      console.error('vibecheck commit-msg requires --file <path>')
      process.exit(1)
    }
    const config = await loadConfig()
    await runCommitMsgHook(config, parsed.flags.file)
    process.exit(0)
  }

  const headConfig = await loadConfig()

  if (parsed.command === 'audit') {
    let range: string
    try {
      range = auditRange(parsed.flags.since)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
    const hits = findAuditHits(await loadAuditCommits(process.cwd(), range), headConfig)
    console.log(formatAudit(hits))
    process.exit(hits.length === 0 ? 0 : 1)
  }

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
    let tamperViolations: TamperViolation[] = []

    const runMutation = parsed.flags.mutation || (!parsed.flags.semantic && config.mutation.enabled)
    const runSemantic = parsed.flags.semantic || (!parsed.flags.mutation && config.semanticDiff.enabled)
    const runTamper = !parsed.flags.mutation || parsed.flags.semantic === true
    const runHidden = !parsed.flags.mutation && !parsed.flags.semantic && config.hiddenTests.enabled
    let hiddenReport: HiddenTestReport | undefined

    if (runHidden) {
      try {
        hiddenReport = await runHiddenTests(config, process.cwd(), process.env)
      } catch (err) {
        console.error('Hidden tests failed:', (err as Error).message)
        process.exit(1)
      }
    }

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
    const target = auditTarget(process.env)
    const changedFiles = runSemantic || checkProtected || runTamper
      ? await getChangedFiles(compareRef, target === 'HEAD' ? 'HEAD' : undefined)
      : []
    let protectedViolations: ProtectedTestViolation[] = []

    if (runSemantic || checkProtected) {
      const languages = resolveLanguages(config)
      const files = [...changedFiles]
      if (runSemantic && changedFiles.some(file => /\.(png|gif|jpe?g|webp)$/i.test(file))) {
        const hits = await listWorktreeFilesContaining('matchesGoldenFile', target)
        files.push(...extraGoldenTestFiles(changedFiles, hits))
      }
      for (const file of files) {
        if (!runSemantic && !isProtectedTestFile(file, config)) continue
        const language = languageForFile(file, languages)
        if (!language) continue
        const before = await getFileAtRef(file, compareRef)
        const after = (await readAuditedFile(file, target)) ?? ''
        const sides = semanticDiffSides(before, after)
        if (!sides && runSemantic && after.trim()) {
          semanticViolations.push(...(await detectAddedTestFile(after, file, language.adapter)))
        }
        if (sides) {
          semanticViolations.push(...(await detectWeakeningWithAdapter(sides.before, sides.after, file, language.adapter)))
          if (runSemantic && sides.after.trim()) {
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

    if (runTamper && changedFiles.length > 0) {
      const changes = []
      for (const file of changedFiles) {
        if (!tamperCandidate(file)) continue
        changes.push({
          file,
          before: await getFileAtRef(file, compareRef),
          after: (await readAuditedFile(file, target)) ?? '',
        })
      }
      tamperViolations = detectTamper(changes)
    }

    if (checkProtected) {
      protectedViolations = await checkProtectedTests({
        config,
        changedFiles,
        semanticViolations,
        readBase: async file => (await getFileAtRef(file, compareRef)) || null,
        readHead: async file => readAuditedFile(file, target),
      })
    }

    const effectiveConfig = parsed.flags.threshold !== undefined ? { ...config, threshold: parsed.flags.threshold } : config

    const result = await runCheck(effectiveConfig, {
      mutationScore,
      mutationReport,
      semanticViolations,
      configViolations: resolved.configViolations,
      protectedViolations,
      tamperViolations,
      hidden: hiddenReport,
      ran: { mutation: runMutation, semanticDiff: runSemantic, hiddenTests: runHidden },
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
