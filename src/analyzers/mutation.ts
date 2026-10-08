import { execa } from 'execa'
import { readFileSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type MutationConfig = {
  enabled: boolean
  tool: 'stryker'
  threshold: number
  perFileThreshold: number
  include: string[]
  exclude: string[]
}

export type SurvivedMutant = {
  file: string
  mutator: string
  location: { line: number; column: number }
  replacement: string
}

export type MutationReport = {
  overallScore: number
  fileScores: Record<string, number>
  survivingMutants: SurvivedMutant[]
  /** True when only the diff against the base ref was mutated. Not comparable to a full run. */
  diffScoped?: boolean
}

/** A report that keeps its raw counts, so reports from several languages can
 *  be merged by mutant rather than averaged by report. */
export type CountedMutationReport = MutationReport & {
  killed: number
  total: number
}

type MutationViolation =
  | { type: 'mutation-score-below-threshold'; score: number; threshold: number; survivingMutants: SurvivedMutant[] }
  | { type: 'file-mutation-score-below-threshold'; file: string; score: number; threshold: number }

type MutationResult =
  | { ok: true }
  | { ok: false; violations: MutationViolation[] }

type StrykerMutant = {
  id: string
  status: string
  mutatorName: string
  location: { start: { line: number; column: number } }
  replacement: string
}

type StrykerReport = {
  files: Record<string, { mutants: StrykerMutant[] }>
}

/** What a mutant does to the shared score.
 *  killed: the tests did not pass (including a timeout).
 *  survived: the tests passed anyway.
 *  uncovered: nothing executed the mutant.
 *  ignored: not a verdict (does not compile, or was not run). */
export type MutantKind = 'killed' | 'survived' | 'uncovered' | 'ignored'

export function tallyKinds(kinds: readonly MutantKind[]): { killed: number; total: number; score: number } {
  const counted = kinds.filter(kind => kind !== 'ignored')
  const killed = counted.filter(kind => kind === 'killed').length
  const total = counted.length
  return { killed, total, score: total === 0 ? 100 : (killed / total) * 100 }
}

function strykerKind(status: string): MutantKind {
  switch (status.toLowerCase()) {
    case 'killed':
    case 'timeout':
    case 'runtimeerror':
      return 'killed'
    case 'survived':
      return 'survived'
    case 'nocoverage':
      return 'uncovered'
    case 'compileerror':
    case 'ignored':
      return 'ignored'
    default:
      throw new Error(
        `Stryker mutant status '${status}' is not a finished result. ` +
          'A pending or unknown status must not be scored as a kill.',
      )
  }
}

export function extractScores(report: StrykerReport): CountedMutationReport {
  const fileScores: Record<string, number> = {}
  const survivingMutants: SurvivedMutant[] = []
  let totalKilled = 0
  let totalMutants = 0

  for (const [file, data] of Object.entries(report.files)) {
    const kinds = data.mutants.map(mutant => strykerKind(mutant.status))
    const tally = tallyKinds(kinds)
    fileScores[file] = tally.score
    totalKilled += tally.killed
    totalMutants += tally.total

    for (const mutant of data.mutants) {
      const kind = strykerKind(mutant.status)
      if (kind !== 'survived' && kind !== 'uncovered') continue
      survivingMutants.push({
        file,
        mutator: mutant.mutatorName,
        location: { line: mutant.location.start.line, column: mutant.location.start.column },
        replacement: mutant.replacement,
      })
    }
  }

  return {
    overallScore: totalMutants === 0 ? 100 : (totalKilled / totalMutants) * 100,
    fileScores,
    survivingMutants,
    killed: totalKilled,
    total: totalMutants,
  }
}

export function mergeMutationReports(reports: CountedMutationReport[]): CountedMutationReport {
  const killed = reports.reduce((sum, r) => sum + r.killed, 0)
  const total = reports.reduce((sum, r) => sum + r.total, 0)
  const diffScoped = reports.some(report => report.diffScoped)
  return {
    overallScore: total === 0 ? 100 : (killed / total) * 100,
    fileScores: Object.assign({}, ...reports.map(r => r.fileScores)),
    survivingMutants: reports.flatMap(r => r.survivingMutants),
    killed,
    total,
    ...(diffScoped ? { diffScoped: true } : {}),
  }
}

export function checkMutationThresholds(
  report: MutationReport,
  config: MutationConfig,
): MutationResult {
  const violations: MutationViolation[] = []

  if (report.overallScore < config.threshold) {
    violations.push({
      type: 'mutation-score-below-threshold',
      score: report.overallScore,
      threshold: config.threshold,
      survivingMutants: report.survivingMutants,
    })
  }

  for (const [file, score] of Object.entries(report.fileScores)) {
    if (score < config.perFileThreshold) {
      violations.push({
        type: 'file-mutation-score-below-threshold',
        file,
        score,
        threshold: config.perFileThreshold,
      })
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations }
}

/** Stryker 10's default. Older releases used the same path unless a config overrode it. */
const DEFAULT_STRYKER_REPORT = 'reports/mutation/mutation.json'

const STRYKER_CONFIG_FILES = ['stryker.config.json', 'stryker.conf.json', '.stryker.config.json', '.stryker.conf.json']

/** `--jsonReporter.fileName` was removed from the Stryker CLI. The report path
 *  lives in the JSON config, and otherwise falls back to Stryker's default. */
export function strykerReportPath(cwd: string): string {
  for (const name of STRYKER_CONFIG_FILES) {
    try {
      const parsed = JSON.parse(readFileSync(join(cwd, name), 'utf-8')) as { jsonReporter?: { fileName?: unknown } }
      const fileName = parsed.jsonReporter?.fileName
      if (typeof fileName === 'string' && fileName.length > 0) return fileName
    } catch {
      // Absent, unreadable, or not JSON. A JS config is not evaluated.
    }
  }
  return DEFAULT_STRYKER_REPORT
}

/** The unscoped `stryker` package on npm is an abandoned pre-2019 tool.
 *  `npx stryker` with nothing installed locally installs that, not
 *  `@stryker-mutator/core`. Only a project-local binary is acceptable. */
export async function resolveStrykerBin(cwd: string): Promise<string> {
  const bin = join(cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'stryker.cmd' : 'stryker')
  try {
    await access(bin)
    return bin
  } catch {
    throw new Error(
      `Stryker is not installed in this project (looked for ${bin}). ` +
        'Install @stryker-mutator/core and a runner (for example @stryker-mutator/vitest-runner). ' +
        'Do not use the unscoped `stryker` package: `npx stryker` resolves to the abandoned stryker@1.0.1 tool.',
    )
  }
}

/** Stryker starts from "mutate nothing" and only includes positive patterns.
 *  An empty include therefore mutates nothing, which is what the config says. */
export function strykerMutateArg(include: string[], exclude: string[]): string {
  const positive = include.map(pattern => pattern.trim()).filter(Boolean)
  const negative = exclude
    .map(pattern => pattern.trim())
    .filter(Boolean)
    .map(pattern => (pattern.startsWith('!') ? pattern : `!${pattern}`))
  const parts = [...positive, ...negative]
  return parts.length > 0 ? parts.join(',') : '!**/*'
}

export async function runMutationAnalysis(config: MutationConfig, cwd = process.cwd()): Promise<CountedMutationReport> {
  const bin = await resolveStrykerBin(cwd)
  // `--jsonReporter.fileName` is not a Stryker 10 option. Passing it makes
  // current releases exit before any mutant runs.
  await execa(bin, ['run', '--reporters', 'json', '--mutate', strykerMutateArg(config.include, config.exclude)], { cwd })

  const raw = await readFile(join(cwd, strykerReportPath(cwd)), 'utf-8')
  const report: StrykerReport = JSON.parse(raw)
  return extractScores(report)
}
