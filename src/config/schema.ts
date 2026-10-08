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
  'tautological-assertion',
  'weak-new-test',
  'suspicious-assertion',
  'assertion-changed',
  'test-body-changed',
  'setup-changed',
  'assertion-neutralized',
  'golden-updated',
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
        'tautological-assertion',
        'weak-new-test',
        'suspicious-assertion',
        'assertion-changed',
        'test-body-changed',
        'setup-changed',
        'assertion-neutralized',
        'golden-updated',
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

const hiddenGate = {
  /** Only a project-local Vitest binary is invoked. */
  tool: z.enum(['vitest']).default('vitest'),
  /** Pass rate (0–100) below this fails the check when enforcement is block. */
  threshold: z.number().min(0).max(100).default(100),
  enforcement: z.enum(['block', 'warn']).default('block'),
}

const hiddenTestsDirectorySchema = z.object({
  enabled: z.literal(true),
  source: z.literal('directory'),
  path: z.string().min(1),
  ...hiddenGate,
})

const hiddenTestsRepoSchema = z.object({
  enabled: z.literal(true),
  source: z.literal('repo'),
  url: z.string().min(1),
  branch: z.string().default('main'),
  ...hiddenGate,
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
    // Deprecated: nothing proves a commit is human, so a commit with no agent
    // signal is enforced at `unknown`. Kept so existing configs still parse.
    humans: enforcementLevel.default('warn'),
    // A commit with no agent signal. Leaving out a trailer is the easiest
    // state for an agent to be in, so this must not default to lenient.
    unknown: enforcementLevel.default('block'),
  })
  .default({})

// Every field is optional so it can fall back: the typescript entry to the
// top-level `testPatterns` and `mutation`, any other language to its adapter.
const languageSchema = z.object({
  enabled: z.boolean().default(true),
  testPatterns: z.array(z.string()).optional(),
  mutation: z
    .object({
      enabled: z.boolean().default(true),
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
    })
    .default({}),
})

const protectedTestsSchema = z
  .object({
    // Any weakening in these files, or deleting one, always blocks.
    files: z.array(z.string()).default([]),
    // A changed file matching `path` must keep every identifier it referenced
    // on the base branch.
    required: z
      .array(z.object({ path: z.string(), references: z.array(z.string()).min(1) }))
      .default([]),
  })
  .default({})

const reporterSchema = z.enum(['console', 'github', 'gitlab'])

export const configSchema = z.object({
  testPatterns: z
    .array(z.string())
    .default(['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts']),

  protectedBranch: z.string().default('main'),

  // Minimum composite integrity score (0-100). Gates the score only; each
  // analyzer keeps its own threshold.
  threshold: z.number().min(0).max(100).default(80),

  agentTrailers: z
    .array(z.string())
    .default([
      'Co-Authored-By: Claude',
      'Co-Authored-By: GitHub Copilot',
      'Co-Authored-By: cursor',
    ]),

  // Environment variables whose presence (non-empty) marks an agent session.
  // Claude Code sets CLAUDECODE in every shell it runs.
  agentEnvVars: z.array(z.string()).default(['CLAUDECODE']),

  enforcement: enforcementSchema,

  mutation: mutationSchema,
  // Empty means TypeScript only, configured by the top-level fields above.
  languages: z.record(z.string(), languageSchema).default({}),
  semanticDiff: semanticDiffSchema,
  protectedTests: protectedTestsSchema,
  propertyTests: propertyTestsSchema,
  hiddenTests: hiddenTestsSchema,

  reporters: z.array(reporterSchema).default(['console']),
})

export type Config = z.infer<typeof configSchema>

export const defaultConfig: Config = configSchema.parse({})

export function defineConfig(config: Partial<z.input<typeof configSchema>>): Config {
  return configSchema.parse(config)
}
