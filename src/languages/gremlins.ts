import { execa } from 'execa'
import { constants } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import micromatch from 'micromatch'
import {
  mergeMutationReports,
  tallyKinds,
  type CountedMutationReport,
  type MutantKind,
  type SurvivedMutant,
} from '../analyzers/mutation.js'
import type { MutationRunOptions } from './types.js'

const INSTALL = 'go install github.com/go-gremlins/gremlins/cmd/gremlins@v0.6.0'

/** Passed with --config so a project's .gremlins.yaml is never read.
 *  That file can disable mutators or set efficacy / coverage thresholds;
 *  vibecheck's thresholds are the only gate. GREMLINS_* env vars are
 *  stripped from the child for the same reason. */
const GENERATED_CONFIG = `unleash:
  threshold:
    efficacy: 0
    mutant-coverage: 0
`

type GremlinsMutation = {
  line: number
  column: number
  type: string
  status: string
}

type GremlinsFile = {
  file_name: string
  mutations: GremlinsMutation[]
}

export type GremlinsFilter = {
  include: string[]
  exclude: string[]
  /** True when gremlins was already pointed at package directories. Include globs are not applied again. */
  packageScoped?: boolean
}

function unparsable(detail: string): Error {
  return new Error(`Gremlins report is unparsable: ${detail} Refusing to score that as 100.`)
}

function missingGremlins(): Error {
  return new Error(
    'gremlins is not installed (looked for `gremlins` on PATH). ' +
      `Install it with: ${INSTALL}`,
  )
}

/** KILLED / (KILLED + LIVED + NOT COVERED). TIMED OUT is a kill.
 *  NOT VIABLE and SKIPPED are ignored. RUNNABLE is a dry-run, not a result. */
export function gremlinKind(status: string): MutantKind {
  const normalized = status.toUpperCase().replace(/[\s_]+/g, '')
  switch (normalized) {
    case 'KILLED':
    case 'TIMEDOUT':
      return 'killed'
    case 'LIVED':
      return 'survived'
    case 'NOTCOVERED':
      return 'uncovered'
    case 'NOTVIABLE':
    case 'SKIPPED':
      return 'ignored'
    case 'RUNNABLE':
      throw new Error(
        "Gremlins mutant status 'RUNNABLE' is a dry-run, not a finished result. Refusing to score it.",
      )
    default:
      throw new Error(
        `Gremlins mutant status '${status}' is not a finished result. Refusing to score it.`,
      )
  }
}

function readFiles(raw: unknown): GremlinsFile[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw unparsable('expected a JSON object with a files array.')
  const files = (raw as { files?: unknown }).files
  if (!Array.isArray(files)) throw unparsable('expected a JSON object with a files array.')
  return files.map(readFileEntry)
}

function readFileEntry(raw: unknown): GremlinsFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw unparsable('a file entry is not an object.')
  const file = raw as { file_name?: unknown; mutations?: unknown }
  if (typeof file.file_name !== 'string' || !Array.isArray(file.mutations)) {
    throw unparsable('a file entry is missing file_name or mutations.')
  }
  return { file_name: file.file_name, mutations: file.mutations.map(readMutation) }
}

function readMutation(raw: unknown): GremlinsMutation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw unparsable('a mutation entry is not an object.')
  const mutation = raw as { line?: unknown; column?: unknown; type?: unknown; status?: unknown }
  if (
    typeof mutation.line !== 'number' ||
    typeof mutation.column !== 'number' ||
    typeof mutation.type !== 'string' ||
    typeof mutation.status !== 'string'
  ) {
    throw unparsable('a mutation is missing line, column, type, or status.')
  }
  return { line: mutation.line, column: mutation.column, type: mutation.type, status: mutation.status }
}

function hasGlob(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern)
}

function normalizePath(file: string): string {
  const slashed = file.replaceAll('\\', '/')
  return slashed.startsWith('./') ? slashed.slice(2) : slashed
}

function matchPattern(file: string, pattern: string): boolean {
  if (!hasGlob(pattern)) {
    const dir = pattern.replace(/^\.\//, '').replace(/\/+$/, '')
    if (dir === '' || dir === '.') return true
    return file === dir || file.startsWith(`${dir}/`)
  }
  return micromatch.isMatch(file, pattern, { dot: true })
}

function keepFile(file: string, filter: GremlinsFilter): boolean {
  const name = normalizePath(file)
  if (name.endsWith('_test.go')) return false
  if (filter.exclude.length > 0 && micromatch.isMatch(name, filter.exclude, { dot: true })) return false
  if (!filter.packageScoped && filter.include.some(hasGlob)) {
    return filter.include.some(pattern => matchPattern(name, pattern))
  }
  return true
}

function scoreFiles(files: GremlinsFile[]): CountedMutationReport {
  const fileScores: Record<string, number> = {}
  const survivingMutants: SurvivedMutant[] = []
  const all: MutantKind[] = []
  let seen = 0

  for (const file of files) {
    const kinds = file.mutations.map(mutation => gremlinKind(mutation.status))
    seen += kinds.length
    all.push(...kinds)
    fileScores[file.file_name] = tallyKinds(kinds).score
    file.mutations.forEach((mutation, index) => {
      const kind = kinds[index]
      if (kind !== 'survived' && kind !== 'uncovered') return
      survivingMutants.push({
        file: file.file_name,
        mutator: mutation.type,
        location: { line: mutation.line, column: mutation.column },
        replacement: mutation.status,
      })
    })
  }

  if (seen > 0 && tallyKinds(all).total === 0) {
    throw new Error(
      'Gremlins produced no tested mutants (every mutant was skipped or not viable). Refusing to score that as 100.',
    )
  }

  const tally = tallyKinds(all)
  return {
    overallScore: tally.score,
    fileScores,
    survivingMutants,
    killed: tally.killed,
    total: tally.total,
  }
}

/** Parse a gremlins JSON report into the shared mutation score.
 *  Score is killed / (killed + survived + uncovered). An empty `files` array
 *  is 100 (nothing to mutate). A report whose mutants are all skipped or not
 *  viable throws. */
export function parseGremlinsReport(raw: unknown, filter?: GremlinsFilter): CountedMutationReport {
  const files = readFiles(raw)
  const kept = filter ? files.filter(file => keepFile(file.file_name, filter)) : files
  return scoreFiles(kept)
}

export async function resolveGremlinsBin(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const names = process.platform === 'win32' ? ['gremlins.exe', 'gremlins.cmd', 'gremlins'] : ['gremlins']
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const name of names) {
      const candidate = join(dir, name)
      try {
        const info = await stat(candidate)
        if (info.isFile() && (info.mode & constants.S_IXUSR || info.mode & constants.S_IXGRP || info.mode & constants.S_IXOTH)) {
          return candidate
        }
      } catch {
        // Not this directory.
      }
    }
  }
  throw missingGremlins()
}

function isEnoent(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  if ((error as { code?: unknown }).code === 'ENOENT') return true
  return isEnoent((error as { cause?: unknown }).cause)
}

function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error)
  const err = error as { stderr?: unknown; shortMessage?: unknown; message?: unknown }
  const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : ''
  const short = typeof err.shortMessage === 'string' ? err.shortMessage : ''
  const message = typeof err.message === 'string' ? err.message : ''
  return stderr || short || message || 'gremlins exited with an error'
}

function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase().startsWith('GREMLINS_')) continue
    next[key] = value
  }
  return next
}

/** Diff-scoped only in CI. A local run mutates the whole module, because a
 *  diff score is not comparable to the threshold a developer just saw locally. */
function diffRef(env: NodeJS.ProcessEnv, protectedBranch: string): string | undefined {
  if (!env.CI) return undefined
  const base = env.GITHUB_BASE_REF || protectedBranch
  return `origin/${base}`
}

function runTargets(include: string[]): { packageScoped: boolean; paths: string[] } {
  if (include.length > 0 && include.every(pattern => !hasGlob(pattern))) {
    return { packageScoped: true, paths: [...new Set(include)] }
  }
  return { packageScoped: false, paths: ['.'] }
}

async function runOnce(
  bin: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  pkg: string,
  diff: string | undefined,
  filter: GremlinsFilter,
): Promise<CountedMutationReport> {
  const dir = await mkdtemp(join(tmpdir(), 'vibecheck-gremlins-'))
  try {
    const configPath = join(dir, 'gremlins.yaml')
    const outputPath = join(dir, 'report.json')
    await writeFile(configPath, GENERATED_CONFIG)
    const args = ['unleash', pkg, '--config', configPath, '--output', outputPath]
    if (diff) args.push('--diff', diff)
    try {
      await execa(bin, args, { cwd, env: childEnv(env), extendEnv: false })
    } catch (error) {
      if (isEnoent(error)) throw missingGremlins()
      throw new Error(`Gremlins failed: ${errorText(error)}. A failed run is not a mutation score.`)
    }

    let text: string
    try {
      text = await readFile(outputPath, 'utf8')
    } catch {
      throw new Error('Gremlins wrote no JSON report. Refusing to score that as 100.')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw unparsable('the output is not JSON.')
    }
    const report = parseGremlinsReport(parsed, filter)
    return diff ? { ...report, diffScoped: true } : report
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Run gremlins and score it with the same rule as Stryker.
 *  gremlins is not a dependency: it has to be on PATH. */
export async function runGremlinsMutation(
  options: MutationRunOptions,
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<CountedMutationReport> {
  const bin = await resolveGremlinsBin(env)
  const diff = diffRef(env, options.protectedBranch)
  const { packageScoped, paths } = runTargets(options.include)
  const filter: GremlinsFilter = { include: options.include, exclude: options.exclude, packageScoped }
  const reports: CountedMutationReport[] = []
  for (const pkg of paths) {
    reports.push(await runOnce(bin, cwd, env, pkg, diff, filter))
  }
  return reports.length === 1 ? reports[0] : mergeMutationReports(reports)
}
