import { extractSetup, extractTests } from '../analyzers/test-ast.js'
import { typescriptAssertionStrength } from '../analyzers/semantic-diff.js'
import { runMutationAnalysis } from '../analyzers/mutation.js'
import { defaultConfig } from '../config/schema.js'
import type { LanguageAdapter } from './types.js'

/** Jest/Vitest tests parsed with Babel; mutation testing through Stryker. */
export const typescriptAdapter: LanguageAdapter = {
  id: 'typescript',
  testPatterns: defaultConfig.testPatterns,
  sourcePatterns: defaultConfig.mutation.include,
  extractTests: async source => extractTests(source),
  extractSetup: async source => extractSetup(source),
  assertionStrength: typescriptAssertionStrength,
  runMutation: options => runMutationAnalysis(options.mutation),
}
