import { execa } from 'execa'
import { readFile } from 'node:fs/promises'

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

export function extractScores(report: StrykerReport): MutationReport {
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

export async function runMutationAnalysis(config: MutationConfig): Promise<MutationReport> {
  await execa('npx', [
    'stryker', 'run',
    '--reporters', 'json',
    '--jsonReporter.fileName', STRYKER_REPORT_PATH,
  ])

  const raw = await readFile(STRYKER_REPORT_PATH, 'utf-8')
  const report: StrykerReport = JSON.parse(raw)
  return extractScores(report)
}
