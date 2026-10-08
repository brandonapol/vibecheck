import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { execa } from 'execa'
import type { Config } from '../config/schema.js'

export type HiddenTestReport = {
  /** 0–100. Skipped and todo tests are not passes. An empty run is 0. */
  passRate: number
  passed: number
  failed: number
  skipped: number
  total: number
  failures: string[]
}

type JsonAssertion = { status?: string; fullName?: string; title?: string }
type JsonFile = { status?: string; name?: string; message?: string; assertionResults?: JsonAssertion[] }
type JsonReport = { testResults?: JsonFile[] }

const CONFIG_NAMES = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.mjs',
  'vitest.config.js',
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.mjs',
  'vite.config.js',
]

const CACHE_DIR = '.vibecheck-cache'
const CLONE_DIR = 'hidden-tests'

/**
 * Pass rate from a Vitest JSON report. Only `passed` counts. A file that
 * failed to load, with no assertions, counts as one failure. No tests is 0,
 * not 100.
 */
export function scoreHiddenReport(raw: unknown): HiddenTestReport {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as JsonReport).testResults)) {
    throw new Error('Hidden tests report is unparsable. Expected a Vitest JSON report with testResults.')
  }
  const files = (raw as JsonReport).testResults ?? []
  let passed = 0
  let failed = 0
  let skipped = 0
  const failures: string[] = []

  for (const file of files) {
    const assertions = file.assertionResults ?? []
    if (assertions.length === 0 && file.status === 'failed') {
      failed++
      failures.push(file.message || file.name || 'failed to load')
      continue
    }
    for (const test of assertions) {
      if (test.status === 'passed') passed++
      else if (test.status === 'failed') {
        failed++
        failures.push(test.fullName || test.title || file.name || 'failed')
      } else skipped++
    }
  }

  const total = passed + failed + skipped
  const passRate = total === 0 ? 0 : Math.round((passed / total) * 1000) / 10
  return { passRate, passed, failed, skipped, total, failures }
}

export async function resolveVitestBin(cwd: string): Promise<string> {
  const bin = join(cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.cmd' : 'vitest')
  try {
    await access(bin)
    return bin
  } catch {
    throw new Error(
      `Vitest is not installed in this project (looked for ${bin}). ` +
        'Install vitest. Do not use npx vitest.',
    )
  }
}

/** Directory of hidden tests, inside the project. Repo source is cloned here and removed afterwards. */
export function hiddenTestsDir(config: Config, cwd: string): string {
  if (!config.hiddenTests.enabled) throw new Error('Hidden tests are disabled')
  if (config.hiddenTests.source === 'directory') return resolveInside(cwd, config.hiddenTests.path)
  return join(cwd, CACHE_DIR, CLONE_DIR)
}

/**
 * Run the holdout suite. Vitest is the project-local binary. Its config's
 * `include` is replaced so a project that only lists `src` still runs this
 * directory, while aliases and setupFiles from that config are kept.
 * Imports are not rewritten: a test file here imports the implementation the
 * same way a file in this directory would.
 */
export async function runHiddenTests(
  config: Config,
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<HiddenTestReport> {
  if (!config.hiddenTests.enabled) throw new Error('Hidden tests are disabled')
  const bin = await resolveVitestBin(cwd)
  const cache = join(cwd, CACHE_DIR)
  const testsDir = hiddenTestsDir(config, cwd)
  const configFile = join(cache, 'hidden-vitest.config.ts')
  const reportFile = join(cache, 'hidden-report.json')
  await mkdir(cache, { recursive: true })
  let keyPath: { path: string; owned: boolean } | undefined

  try {
    if (config.hiddenTests.source === 'repo') {
      keyPath = await writeDeployKey(env.VIBECHECK_HIDDEN_TESTS_KEY, cache)
      await rm(testsDir, { recursive: true, force: true })
      await cloneRepo(config.hiddenTests.url, config.hiddenTests.branch, testsDir, env, keyPath)
    }
    if (!existsSync(testsDir)) {
      throw new Error(
        `Hidden tests directory does not exist: ${testsDir}. ` +
          (config.hiddenTests.source === 'directory'
            ? 'Create it, or disable hiddenTests.'
            : 'The clone did not produce a directory.'),
      )
    }
    await writeFile(configFile, vitestConfigSource(cwd, testsDir))
    const result = await execa(bin, ['run', '--config', configFile, '--reporter', 'json', '--outputFile', reportFile], {
      cwd,
      reject: false,
      // A parent Vitest (or `vibecheck` itself under test) sets these. The child
      // must be a normal run, not a worker of the process that launched it.
      env: vitestEnv(env),
      extendEnv: false,
    })
    if (!existsSync(reportFile)) {
      const detail = (result.stderr || result.stdout || `vitest exited ${result.exitCode}`).trim()
      throw new Error(`Hidden tests failed before writing a report. ${detail}`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(reportFile, 'utf-8'))
    } catch {
      throw new Error('Hidden tests report is unparsable. Expected a Vitest JSON report with testResults.')
    }
    return scoreHiddenReport(parsed)
  } finally {
    await rm(configFile, { force: true })
    await rm(reportFile, { force: true })
    if (config.hiddenTests.source === 'repo') await rm(testsDir, { recursive: true, force: true })
    if (keyPath?.owned) await rm(keyPath.path, { force: true })
  }
}

function resolveInside(cwd: string, path: string): string {
  const resolved = resolve(cwd, path)
  const rel = relative(cwd, resolved)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Hidden tests directory must be inside the project, not '${path}'`)
  }
  return resolved
}

export function vitestConfigSource(cwd: string, testsDir: string): string {
  const include = `${relative(cwd, testsDir).replace(/\\/g, '/')}/**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}`
  const user = CONFIG_NAMES.map(name => join(cwd, name)).find(file => existsSync(file))
  const override = `
    root: ${JSON.stringify(cwd)},
    include: [${JSON.stringify(include)}],
    passWithNoTests: false,`
  if (!user) {
    return `export default { test: {${override}\n} }\n`
  }
  return `import userConfig from ${JSON.stringify(user)}
export default (async () => {
  const loaded = userConfig?.default ?? userConfig
  const user = typeof loaded === 'function' ? await loaded() : loaded
  const base = user && typeof user === 'object' ? user : {}
  const test = base.test && typeof base.test === 'object' ? base.test : {}
  return { ...base, test: { ...test,${override}\n} }
})()
`
}

async function cloneRepo(
  url: string,
  branch: string,
  dest: string,
  env: NodeJS.ProcessEnv,
  key: { path: string } | undefined,
): Promise<void> {
  const gitEnv: NodeJS.ProcessEnv = { ...env }
  if (key) {
    gitEnv.GIT_SSH_COMMAND = `ssh -i ${shellQuote(key.path)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`
  }
  try {
    await execa('git', ['clone', '--depth', '1', '--branch', branch, url, dest], { env: gitEnv })
  } catch (err) {
    const detail = ((err as { stderr?: string }).stderr || (err as Error).message || 'git clone failed').trim()
    throw new Error(`Could not clone hidden tests from '${url}' (branch ${branch}). ${detail}`)
  }
}

/** A path, or the key material itself (`-----BEGIN ...`). Material is written to a file we delete. */
async function writeDeployKey(
  value: string | undefined,
  cache: string,
): Promise<{ path: string; owned: boolean } | undefined> {
  if (!value) return undefined
  if (!value.includes('-----BEGIN')) return { path: value, owned: false }
  const path = join(cache, 'deploy-key')
  await writeFile(path, value.endsWith('\n') ? value : `${value}\n`, { mode: 0o600 })
  return { path, owned: true }
}

function vitestEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue
    if (key === 'VITEST' || key.startsWith('VITEST_')) continue
    env[key] = value
  }
  return env
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
