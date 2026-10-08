import type { Config } from '../config/schema.js'
import { resolveLanguages } from '../languages/registry.js'

/** Test globs the enabled languages actually use. With no `languages`
 *  entry this is the top-level list. */
export function patternsForConfig(config: Config): string[] {
  const seen = new Set<string>()
  const patterns: string[] = []
  for (const language of resolveLanguages(config)) {
    if (!language.enabled) continue
    for (const pattern of language.testPatterns) {
      if (seen.has(pattern)) continue
      seen.add(pattern)
      patterns.push(pattern)
    }
  }
  return patterns
}
