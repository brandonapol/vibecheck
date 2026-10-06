import micromatch from 'micromatch'
import type { Config } from '../config/schema.js'
import type { LanguageAdapter, ResolvedLanguage } from './types.js'
import { typescriptAdapter } from './typescript.js'
import { goAdapter } from './go.js'
import { dartAdapter } from './dart.js'

const adapters = new Map<string, LanguageAdapter>(
  [typescriptAdapter, goAdapter, dartAdapter].map(adapter => [adapter.id, adapter]),
)

/** Returns a function that unregisters the adapter. */
export function registerAdapter(adapter: LanguageAdapter): () => void {
  if (adapters.has(adapter.id)) {
    throw new Error(`An adapter for language '${adapter.id}' is already registered`)
  }
  adapters.set(adapter.id, adapter)
  return () => {
    adapters.delete(adapter.id)
  }
}

export function getAdapter(id: string): LanguageAdapter | undefined {
  return adapters.get(id)
}

export function resolveLanguages(config: Config): ResolvedLanguage[] {
  const entries = Object.entries(config.languages)
  if (entries.length === 0) {
    return [
      {
        id: typescriptAdapter.id,
        adapter: typescriptAdapter,
        enabled: true,
        testPatterns: config.testPatterns,
        mutation: { enabled: true, include: config.mutation.include, exclude: config.mutation.exclude },
        source: 'top-level',
      },
    ]
  }

  return entries.map(([id, language]) => {
    const adapter = adapters.get(id)
    if (!adapter) throw new Error(`No adapter registered for language '${id}'`)
    const isTypescript = id === typescriptAdapter.id
    return {
      id,
      adapter,
      enabled: language.enabled,
      testPatterns: language.testPatterns ?? (isTypescript ? config.testPatterns : adapter.testPatterns),
      mutation: {
        enabled: language.mutation.enabled,
        include: language.mutation.include ?? (isTypescript ? config.mutation.include : adapter.sourcePatterns),
        exclude: language.mutation.exclude ?? (isTypescript ? config.mutation.exclude : []),
      },
      source: 'languages',
    }
  })
}

/** The first enabled language whose test patterns match `file`. */
export function languageForFile(file: string, languages: ResolvedLanguage[]): ResolvedLanguage | null {
  return languages.find(l => l.enabled && micromatch.isMatch(file, l.testPatterns)) ?? null
}
