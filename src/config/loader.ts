import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createJiti } from 'jiti'
import { configSchema, defaultConfig, type Config } from './schema.js'

const CONFIG_FILENAME = 'vibecheck.config.ts'

function configExport(mod: unknown): unknown {
  if (mod !== null && typeof mod === 'object' && 'default' in mod) {
    const value = (mod as { default: unknown }).default
    if (value !== undefined && value !== null) return value
  }
  return mod
}

/** Load a TypeScript config under plain Node. Native `import()` of `.ts` only works inside vitest. */
async function importConfig(configPath: string): Promise<unknown> {
  const jiti = createJiti(import.meta.url)
  return jiti.import(configPath, { default: true })
}

export async function loadConfig(
  cwd?: string,
  readConfig?: (configPath: string) => Promise<unknown>,
): Promise<Config> {
  const dir = cwd ?? process.cwd()
  const configPath = resolve(dir, CONFIG_FILENAME)

  if (!existsSync(configPath)) {
    return defaultConfig
  }

  const loaded = readConfig ? await readConfig(configPath) : await importConfig(configPath)
  return configSchema.parse(configExport(loaded))
}
