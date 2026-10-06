import { execa } from 'execa'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtractedTest, SetupStatement } from '../analyzers/test-ast.js'

/** What a parser helper prints for one test file. */
export type HelperExtraction = { tests: ExtractedTest[]; setup: SetupStatement[] }

/** A test parser written in the language it parses, shipped as source under
 *  helpers/ and compiled with the user's own toolchain on first use. */
export type HelperSpec = {
  /** Directory under helpers/. */
  dir: string
  /** Files in that directory whose contents key the cached build. */
  sources: string[]
  /** Shown when the toolchain is missing, e.g. "Go toolchain". */
  toolchainName: string
  /** The config key that turns this language off, for error messages. */
  languageKey: string
  /** Compile the helper in `sourceDir` to the executable at `output`. */
  build(toolchain: string, sourceDir: string, output: string): Promise<void>
}

export type HelperOptions = {
  /** The toolchain executable used to build the helper. */
  toolchain: string
  /** Where built helpers are cached, keyed by a hash of their source. */
  cacheDir: string
}

export function helperSourceDir(dir: string): string {
  let current = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const candidate = join(current, 'helpers', dir)
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) throw new Error(`vibecheck: the test parser source (helpers/${dir}) is missing`)
    current = parent
  }
}

async function buildHelper(spec: HelperSpec, { toolchain, cacheDir }: HelperOptions): Promise<string> {
  const sourceDir = helperSourceDir(spec.dir)
  const hash = createHash('sha256')
  for (const file of spec.sources) hash.update(file).update(readFileSync(join(sourceDir, file)))
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const binary = join(cacheDir, `${spec.dir}-${hash.digest('hex').slice(0, 16)}${suffix}`)
  if (existsSync(binary)) return binary

  mkdirSync(cacheDir, { recursive: true })
  const partial = `${binary}.${process.pid}${suffix}`
  try {
    await spec.build(toolchain, sourceDir, partial)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `${spec.toolchainName} not found ('${toolchain}'): install it, or disable languages.${spec.languageKey}`,
      )
    }
    const stderr = (err as { stderr?: string }).stderr
    throw new Error(`Could not build the ${spec.languageKey} test parser: ${stderr || (err as Error).message}`)
  }
  // Rename so a concurrent run never executes a half-written binary.
  renameSync(partial, binary)
  return binary
}

/** Returns an extractor that builds the helper once, then runs it once per
 *  file version, sharing the result between extractTests and extractSetup. */
export function createHelperExtractor(
  spec: HelperSpec,
  options: HelperOptions,
): (source: string, path: string) => Promise<HelperExtraction> {
  let helper: Promise<string> | undefined
  const extractions = new Map<string, Promise<HelperExtraction>>()

  return (source, path) => {
    const key = `${path}\0${source}`
    let pending = extractions.get(key)
    if (!pending) {
      pending = (async () => {
        helper ??= buildHelper(spec, options)
        const binary = await helper
        try {
          const { stdout } = await execa(binary, [], { input: source })
          return JSON.parse(stdout) as HelperExtraction
        } catch (err) {
          const stderr = (err as { stderr?: string }).stderr
          throw new Error(`Could not parse ${path} as ${spec.languageKey}: ${stderr || (err as Error).message}`)
        }
      })()
      extractions.set(key, pending)
    }
    return pending
  }
}
