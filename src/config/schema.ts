import { z } from 'zod'

const enforcementLevel = z.enum(['strict', 'warn', 'off'])

export const configSchema = z.object({
  testPatterns: z
    .array(z.string())
    .default(['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts']),

  protectedBranch: z.string().default('main'),

  agentTrailers: z
    .array(z.string())
    .default([
      'Co-Authored-By: Claude',
      'Co-Authored-By: GitHub Copilot',
      'Co-Authored-By: cursor',
    ]),

  enforcement: z
    .object({
      agents: enforcementLevel.default('strict'),
      humans: enforcementLevel.default('warn'),
    })
    .default({}),

  allowlist: z.array(z.string()).default([]),

  hooks: z
    .object({
      preCommit: z.boolean().default(true),
      commitMsg: z.boolean().default(false),
    })
    .default({}),
})

export type Config = z.infer<typeof configSchema>

export const defaultConfig: Config = configSchema.parse({})

export function defineConfig(config: Partial<z.input<typeof configSchema>>): Config {
  return configSchema.parse(config)
}
