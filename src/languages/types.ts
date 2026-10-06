import type { ExtractedTest, SetupStatement } from '../analyzers/test-ast.js'
import type { CountedMutationReport } from '../analyzers/mutation.js'
import type { Config } from '../config/schema.js'

export type MutationRunOptions = {
  include: string[]
  exclude: string[]
  protectedBranch: string
  mutation: Config['mutation']
}

/** Everything vibecheck needs to know about one language. Analyzers work on
 *  the extracted tests; only the adapter knows how the language spells them. */
export type LanguageAdapter = {
  id: string
  /** Default globs for test files when the config gives none. */
  testPatterns: string[]
  /** Default globs for mutation targets when the config gives none. */
  sourcePatterns: string[]
  /** Async so an adapter can shell out to a parser written in its own language. */
  extractTests(source: string, path: string): Promise<ExtractedTest[]>
  extractSetup(source: string, path: string): Promise<SetupStatement[]>
  /** 0–10 on the shared scale: 4 and below is weak, 5 is neutral. */
  assertionStrength(matcher: string): number
  runMutation?(options: MutationRunOptions): Promise<CountedMutationReport>
}

export type ResolvedLanguage = {
  id: string
  adapter: LanguageAdapter
  enabled: boolean
  testPatterns: string[]
  mutation: { enabled: boolean; include: string[]; exclude: string[] }
  /** 'top-level' when derived from the legacy fields because `languages` is empty. */
  source: 'top-level' | 'languages'
}
