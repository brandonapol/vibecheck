import { execa } from 'execa'
import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { detectConfigWeakening, type ConfigWeakeningViolation } from '../analyzers/config-diff.js'
import { configSchema, defaultConfig, type Config } from '../config/schema.js'

const CONFIG_FILENAME = 'vibecheck.config.ts'

type Git = (args: string[]) => Promise<string>

const runGit: Git = async args => (await execa('git', args)).stdout

/** The config file's source at `ref`, or null when that ref has none.
 *  An unreadable ref is an error: checking against nothing would trust the
 *  branch under review. */
export async function readConfigAtRef(ref: string, git: Git = runGit): Promise<string | null> {
  try {
    return await git(['show', `${ref}:${CONFIG_FILENAME}`])
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? (err as Error).message
    if (/does not exist in|exists on disk, but not in/.test(stderr)) return null
    throw new Error(
      `Could not read ${CONFIG_FILENAME} from '${ref}': ${stderr.trim().replace(/\.$/, '')}. ` +
        'In CI, check out with fetch-depth: 0 so the base branch is available.',
    )
  }
}

/** Evaluates config source that only exists in git. It is written next to the
 *  real config so its imports (`vibecheck-tdd`) resolve the same way. */
export async function evaluateConfigSource(source: string, dir: string): Promise<Config> {
  const path = join(dir, `.vibecheck-base-${randomUUID()}.config.ts`)
  writeFileSync(path, source)
  try {
    const mod = await import(pathToFileURL(path).href)
    return configSchema.parse(mod.default ?? mod)
  } finally {
    rmSync(path, { force: true })
  }
}

export type ResolvedCheckConfig = {
  /** 'base' when the config came from the base ref, 'head' when from the working tree. */
  mode: 'base' | 'head'
  /** The ref the config came from and semantic diff compares against; null in head mode. */
  baseRef: string | null
  config: Config
  /** How the working-tree config weakens the base; always empty in head mode. */
  configViolations: ConfigWeakeningViolation[]
}

export type ResolveCheckConfigOptions = {
  /** The working-tree config, written by whoever wrote the branch under review. */
  head: Config
  env: Record<string, string | undefined>
  /** From --base. Never taken from the head config, which could point at itself. */
  baseRef?: string
  readAtRef?: (ref: string) => Promise<string | null>
  evaluate?: (source: string) => Promise<Config>
}

/** In CI, or when a base ref is given, the base branch's config is the source
 *  of truth and the branch's own config is only checked for weakening. */
export async function resolveCheckConfig({
  head,
  env,
  baseRef,
  readAtRef = ref => readConfigAtRef(ref),
  evaluate = source => evaluateConfigSource(source, process.cwd()),
}: ResolveCheckConfigOptions): Promise<ResolvedCheckConfig> {
  if (!baseRef && !env.CI) {
    return { mode: 'head', baseRef: null, config: head, configViolations: [] }
  }
  const ref = baseRef ?? `origin/${head.protectedBranch}`
  const source = await readAtRef(ref)
  const base = source === null ? defaultConfig : await evaluate(source)
  return { mode: 'base', baseRef: ref, config: base, configViolations: detectConfigWeakening(base, head) }
}
