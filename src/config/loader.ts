import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { configSchema, defaultConfig, type Config } from './schema.js'

const CONFIG_FILENAME = 'agent-tdd.config.ts'

export async function loadConfig(cwd?: string): Promise<Config> {
  const dir = cwd ?? process.cwd()
  const configPath = resolve(dir, CONFIG_FILENAME)

  if (!existsSync(configPath)) {
    return defaultConfig
  }

  const mod = await import(configPath)
  const raw = mod.default ?? mod
  return configSchema.parse(raw)
}
