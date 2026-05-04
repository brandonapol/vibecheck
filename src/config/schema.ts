import { z } from 'zod'

export const configSchema = z.object({})

export type Config = z.infer<typeof configSchema>

export function defineConfig(config: Config): Config {
  return configSchema.parse(config)
}
