import { execa } from 'execa'
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

export function extractScores(report: StrykerReport): CountedMutationReport {
  const fileScores: Record<string, number> = {}
  const survivingMutants: SurvivedMutant[] = []
  let totalKilled = 0
  let totalMutants = 0

  for (const [file, data] of Object.entries(report.files)) {
    const killed = data.mutants.filter(m => m.status === 'Killed').length
    const total = data.mutants.length

    fileScores[file] = total === 0 ? 100 : (killed / total) * 100
    totalKilled += killed
    totalMutants += total

    for (const mutant of data.mutants) {
      if (mutant.status === 'Survived') {
        survivingMutants.push({
          file,
          mutator: mutant.mutatorName,
          location: { line: mutant.location.start.line, column: mutant.location.start.column },
          replacement: mutant.replacement,
        })
      }
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
  return {
    overallScore: total === 0 ? 100 : (killed / total) * 100,
    fileScores: Object.assign({}, ...reports.map(r => r.fileScores)),
    survivingMutants: reports.flatMap(r => r.survivingMutants),
    killed,
    total,
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

const STRYKER_REPORT_PATH = '.stryker-output/report.json'

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

export async function runMutationAnalysis(config: MutationConfig, cwd = process.cwd()): Promise<CountedMutationReport> {
  const bin = await resolveStrykerBin(cwd)
  await execa(bin, [
    'run',
    '--reporters', 'json',
    '--jsonReporter.fileName', STRYKER_REPORT_PATH,
  ], { cwd })

  const raw = await readFile(join(cwd, STRYKER_REPORT_PATH), 'utf-8')
  const report: StrykerReport = JSON.parse(raw)
  return extractScores(report)
}
