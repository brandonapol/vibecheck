import { execa } from 'execa'
import { constants } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { delimiter, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { readdirSync } from 'node:fs'
import micromatch from 'micromatch'
import { tallyKinds, type CountedMutationReport, type MutantKind, type SurvivedMutant } from '../analyzers/mutation.js'
import type { MutationRunOptions } from './types.js'

/** Arithmetic, comparison, boolean, and numeric return mutations.
 *  `return null` is left out: under null safety it mostly fails to compile.
 *  Passed with --rules, which disables mutation_test's builtin rules, and the
 *  input document sets failure="0" so the tool's own threshold is not a gate.
 *  The test command gets 180s. A shorter timeout aborts the unmodified-source
 *  check before a report exists, which is not a score. */
const RULES = `<?xml version="1.0" encoding="UTF-8"?>
<mutations version="1.2">
  <rules>
    <literal text=" + " id="add"><mutation text=" - "/></literal>
    <literal text=" - " id="sub"><mutation text=" + "/></literal>
    <literal text=" * " id="mul"><mutation text=" / "/></literal>
    <literal text=" / " id="div"><mutation text=" * "/></literal>
    <literal text=" == " id="eq"><mutation text=" != "/></literal>
    <literal text=" != " id="neq"><mutation text=" == "/></literal>
    <literal text=" &lt;= " id="lte"><mutation text=" &gt;= "/></literal>
    <literal text=" &gt;= " id="gte"><mutation text=" &lt;= "/></literal>
    <literal text=" &lt; " id="lt"><mutation text=" &gt; "/></literal>
    <literal text=" &gt; " id="gt"><mutation text=" &lt; "/></literal>
    <literal text=" &amp;&amp; " id="and"><mutation text=" || "/></literal>
    <literal text=" || " id="or"><mutation text=" &amp;&amp; "/></literal>
    <regex pattern="\\btrue\\b" id="true"><mutation text="false"/></regex>
    <regex pattern="\\bfalse\\b" id="false"><mutation text="true"/></regex>
    <regex pattern="return ([1-9][0-9]*);" id="return-int"><mutation text="return 0;"/></regex>
    <regex pattern="return true;" id="return-true"><mutation text="return false;"/></regex>
    <regex pattern="return false;" id="return-false"><mutation text="return true;"/></regex>
  </rules>
</mutations>
`

type MutationFilter = { include: string[]; exclude: string[] }

type ParsedMutant = {
  file: string
  mutator: string
  line: number
  replacement: string
  kind: MutantKind
}

const EMPTY: CountedMutationReport = {
  overallScore: 100,
  fileScores: {},
  survivingMutants: [],
  killed: 0,
  total: 0,
}

function unparsable(detail: string): Error {
  return new Error(`mutation_test report is unparsable: ${detail} Refusing to score that as 100.`)
}

function decode(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function attrs(source: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const match of source.matchAll(/([\w:-]+)="([^"]*)"/g)) values[match[1]] = decode(match[2])
  return values
}

function kindOf(body: string): MutantKind {
  const failure = body.match(/<failure\b([^>]*)>/)
  const error = body.match(/<error\b([^>]*)>/)
  if (failure && error) throw unparsable('a testcase has both a failure and an error.')
  if (!failure && !error) return 'killed'
  const type = attrs((failure ?? error)![1]).type ?? ''
  if (failure) {
    if (type === 'undetected') return 'survived'
    throw unparsable(`failure type '${type}' is not a finished result.`)
  }
  if (type === 'timeout') return 'killed'
  if (type === 'not covered by tests') return 'uncovered'
  throw unparsable(`error type '${type}' is not a finished result.`)
}

function lineOf(name: string, body: string): number {
  const fromBody = body.match(/Line:\s*(\d+)/)
  const fromName = name.match(/^Line(\d+)_/)
  const raw = fromBody?.[1] ?? fromName?.[1]
  if (!raw) throw unparsable('a testcase is missing its line number.')
  return Number(raw)
}

function replacementOf(body: string, mutator: string): string {
  const match = body.match(/Mutation:\s*(.*)/)
  return match ? decode(match[1].trim()) : mutator
}

function hasGlob(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern)
}

function normalize(file: string): string {
  const slashed = file.replaceAll('\\', '/')
  return slashed.startsWith('./') ? slashed.slice(2) : slashed
}

function matches(file: string, pattern: string): boolean {
  if (!hasGlob(pattern)) {
    const dir = pattern.replace(/^\.\//, '').replace(/\/+$/, '')
    if (dir === '' || dir === '.') return true
    return file === dir || file.startsWith(`${dir}/`)
  }
  return micromatch.isMatch(file, pattern, { dot: true })
}

function keepFile(file: string, filter: MutationFilter): boolean {
  const name = normalize(file)
  if (name.endsWith('_test.dart') || name.split('/').includes('test')) return false
  if (filter.exclude.length > 0 && micromatch.isMatch(name, filter.exclude, { dot: true })) return false
  if (filter.include.length === 0) return name.endsWith('.dart')
  return filter.include.some(pattern => matches(name, pattern))
}

function scoreMutants(mutants: ParsedMutant[]): CountedMutationReport {
  const byFile = new Map<string, MutantKind[]>()
  const survivingMutants: SurvivedMutant[] = []
  const all: MutantKind[] = []
  for (const mutant of mutants) {
    const kinds = byFile.get(mutant.file) ?? []
    kinds.push(mutant.kind)
    byFile.set(mutant.file, kinds)
    all.push(mutant.kind)
    if (mutant.kind !== 'survived' && mutant.kind !== 'uncovered') continue
    survivingMutants.push({
      file: mutant.file,
      mutator: mutant.mutator,
      location: { line: mutant.line, column: 1 },
      replacement: mutant.replacement,
    })
  }
  const fileScores: Record<string, number> = {}
  for (const [file, kinds] of byFile) fileScores[file] = tallyKinds(kinds).score
  const tally = tallyKinds(all)
  return {
    overallScore: tally.score,
    fileScores,
    survivingMutants,
    killed: tally.killed,
    total: tally.total,
  }
}

/** Parse a mutation_test xunit report. Score is killed / (killed + survived + uncovered).
 *  A timeout is a kill. An empty report is 100. */
export function parseMutationTestReport(xml: string, filter?: MutationFilter): CountedMutationReport {
  if (!xml.includes('<testsuites')) throw unparsable('expected a testsuites document.')
  const mutants: ParsedMutant[] = []
  for (const suite of xml.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g)) {
    const mutator = attrs(suite[1]).name || 'mutation'
    const body = suite[2]
    for (const testcase of body.matchAll(/<testcase\b([^>]*?)\/>|<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)) {
      const parsed = readTestcase(testcase[1] ?? testcase[2], testcase[3] ?? '', mutator)
      if (filter && !keepFile(parsed.file, filter)) continue
      mutants.push(parsed)
    }
  }
  if (mutants.length === 0) return { ...EMPTY }
  return scoreMutants(mutants)
}

function readTestcase(rawAttrs: string, body: string, mutator: string): ParsedMutant {
  const values = attrs(rawAttrs)
  if (!values.classname) throw unparsable('a testcase is missing classname.')
  return {
    file: normalize(values.classname),
    mutator,
    line: lineOf(values.name ?? '', body),
    replacement: replacementOf(body, mutator),
    kind: kindOf(body),
  }
}

const SKIP_DIRS = new Set(['.dart_tool', 'build', '.git', 'node_modules'])

function listDartFiles(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || (entry.isDirectory() && entry.name.startsWith('.'))) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile() && entry.name.endsWith('.dart')) files.push(relative(root, abs).replaceAll('\\', '/'))
    }
  }
  walk(root)
  return files
}

async function resolveDart(env: NodeJS.ProcessEnv): Promise<string> {
  const names = process.platform === 'win32' ? ['dart.exe', 'dart.bat', 'dart'] : ['dart']
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
  throw new Error("Dart SDK not found ('dart'): install it, or set languages.dart.mutation.enabled to false")
}

function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function inputDocument(files: string[]): string {
  const listed = files.map(file => `    <file>${xmlEscape(file)}</file>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<mutations version="1.2">
  <files>
${listed}
  </files>
  <commands>
    <command group="test" expected-return="0" timeout="180">dart test</command>
  </commands>
  <threshold failure="0"/>
</mutations>
`
}

async function changedDartFiles(base: string): Promise<string[]> {
  try {
    const { stdout } = await execa('git', ['diff', '--name-only', '--no-renames', base, 'HEAD'])
    return stdout.split('\n').filter(Boolean)
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr
    const detail = (stderr || (error as Error).message || 'git diff failed').trim()
    throw new Error(
      `Could not list Dart files changed since '${base}'. A git failure is not an empty diff. ${detail}`,
    )
  }
}

/** Run mutation_test 1.8.1 in `cwd` and score the xunit report.
 *  The tool has no diff mode, so in CI only Dart sources changed since the
 *  base ref are listed. Local runs mutate every selected file. */
export async function runMutationTest(
  options: MutationRunOptions,
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<CountedMutationReport> {
  const dart = await resolveDart(env)
  const filter: MutationFilter = { include: options.include, exclude: options.exclude }
  const diffScoped = Boolean(env.CI)
  let files: string[]
  if (diffScoped) {
    const base = `origin/${env.GITHUB_BASE_REF || options.protectedBranch}`
    files = (await changedDartFiles(base)).filter(file => keepFile(file, filter))
  } else {
    files = listDartFiles(cwd).filter(file => keepFile(file, filter))
  }
  if (files.length === 0) return diffScoped ? { ...EMPTY, diffScoped: true } : { ...EMPTY }

  const dir = await mkdtemp(join(tmpdir(), 'vibecheck-mutation-test-'))
  try {
    const outDir = join(dir, 'out')
    await mkdir(outDir)
    const rulesPath = join(dir, 'rules.xml')
    const inputPath = join(dir, 'input.xml')
    await writeFile(rulesPath, RULES)
    await writeFile(inputPath, inputDocument(files))
    let result: { exitCode?: number; stderr?: string; stdout?: string }
    try {
      result = await execa(
        dart,
        ['run', 'mutation_test', '-f', 'xunit', '-o', outDir, '--rules', rulesPath, inputPath],
        { cwd, reject: false },
      )
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'ENOENT') {
        throw new Error("Dart SDK not found ('dart'): install it, or set languages.dart.mutation.enabled to false")
      }
      throw new Error(`mutation_test failed: ${(error as Error).message}. A failed run is not a mutation score.`)
    }
    const reportPath = join(outDir, 'mutation-test.xunit.xml')
    let xml: string
    try {
      xml = await readFile(reportPath, 'utf8')
    } catch {
      const stderr = (result.stderr || '').trim()
      const stdout = (result.stdout || '').trim()
      const detail = [stderr, stdout].filter(Boolean).join('\n')
      throw new Error(
        `mutation_test failed: ${detail || `exit ${result.exitCode}`}. A failed run is not a mutation score.`,
      )
    }
    const report = parseMutationTestReport(xml, filter)
    return diffScoped ? { ...report, diffScoped: true } : report
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
