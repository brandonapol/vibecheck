import { z } from 'zod'

const mutationSchema = z
  .object({
    enabled: z.boolean().default(true),
    tool: z.enum(['stryker']).default('stryker'),
    threshold: z.number().min(0).max(100).default(80),
    perFileThreshold: z.number().min(0).max(100).default(60),
    include: z.array(z.string()).default(['src/**/*.ts']),
    exclude: z.array(z.string()).default(['src/**/*.d.ts', 'src/**/index.ts']),
  })
  .default({})

const weakeningPattern = z.enum([
  'precision-reduction',
  'error-relaxation',
  'bound-loosening',
  'test-deletion',
  'skip-addition',
  'assertion-count-reduction',
])

const semanticDiffSchema = z
  .object({
    enabled: z.boolean().default(true),
    patterns: z
      .array(weakeningPattern)
      .default([
        'precision-reduction',
        'error-relaxation',
        'bound-loosening',
        'test-deletion',
        'skip-addition',
        'assertion-count-reduction',
      ]),
    enforcement: z.enum(['block', 'warn', 'comment']).default('block'),
  })
  .default({})

const propertyTestsSchema = z
  .object({
    enabled: z.boolean().default(false),
    framework: z.enum(['fast-check', 'hypothesis', 'jsverify']).default('fast-check'),
    requiredFor: z.array(z.string()).default([]),
    minIterations: z.number().min(1).default(1000),
  })
  .default({})

const hiddenTestsDirectorySchema = z.object({
  enabled: z.literal(true),
  source: z.literal('directory'),
  path: z.string(),
})

const hiddenTestsRepoSchema = z.object({
  enabled: z.literal(true),
  source: z.literal('repo'),
  url: z.string(),
  branch: z.string().default('main'),
})

const hiddenTestsDisabledSchema = z.object({
  enabled: z.literal(false),
})

const hiddenTestsSchema = z
  .union([
    hiddenTestsDirectorySchema,
    hiddenTestsRepoSchema,
    hiddenTestsDisabledSchema,
  ])
  .default({ enabled: false })

const enforcementLevel = z.enum(['block', 'warn', 'off'])

const enforcementSchema = z
  .object({
    agents: enforcementLevel.default('block'),
    humans: enforcementLevel.default('warn'),
  })
  .default({})

const reporterSchema = z.enum(['console', 'github', 'gitlab'])

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

  enforcement: enforcementSchema,

  mutation: mutationSchema,
  semanticDiff: semanticDiffSchema,
  propertyTests: propertyTestsSchema,
  hiddenTests: hiddenTestsSchema,

  reporters: z.array(reporterSchema).default(['console']),
})

export type Config = z.infer<typeof configSchema>

export const defaultConfig: Config = configSchema.parse({})

export function defineConfig(config: Partial<z.input<typeof configSchema>>): Config {
  return configSchema.parse(config)
}
