import { describe, it, expect, afterEach } from 'vitest'
import { getAdapter, languageForFile, registerAdapter, resolveLanguages } from './registry.js'
import { typescriptAdapter } from './typescript.js'
import { defineConfig } from '../config/schema.js'
import { makeStubAdapter } from '../../test/__tests__/stub-adapter.js'

const cleanups: Array<() => void> = []

function register(adapter = makeStubAdapter()) {
  cleanups.push(registerAdapter(adapter))
  return adapter
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

describe('getAdapter', () => {
  it('ships the typescript adapter', () => {
    expect(getAdapter('typescript')).toBe(typescriptAdapter)
  })

  it('returns undefined for an unregistered language', () => {
    expect(getAdapter('cobol')).toBeUndefined()
  })
})

describe('registerAdapter', () => {
  it('makes an adapter available until the returned cleanup runs', () => {
    const stub = makeStubAdapter()
    const unregister = registerAdapter(stub)
    expect(getAdapter('stub')).toBe(stub)
    unregister()
    expect(getAdapter('stub')).toBeUndefined()
  })

  it('refuses to replace an adapter that is already registered', () => {
    register()
    expect(() => registerAdapter(makeStubAdapter())).toThrow(/already registered/)
  })
})

describe('resolveLanguages', () => {
  it('derives a typescript language from the top-level fields when no languages are configured', () => {
    const config = defineConfig({
      testPatterns: ['**/*.spec.ts'],
      mutation: { include: ['lib/**/*.ts'], exclude: ['lib/gen/**'] },
    })
    const [language, ...rest] = resolveLanguages(config)
    expect(rest).toEqual([])
    expect(language.id).toBe('typescript')
    expect(language.adapter).toBe(typescriptAdapter)
    expect(language.source).toBe('top-level')
    expect(language.enabled).toBe(true)
    expect(language.testPatterns).toEqual(['**/*.spec.ts'])
    expect(language.mutation).toEqual({ enabled: true, include: ['lib/**/*.ts'], exclude: ['lib/gen/**'] })
  })

  it('lets an explicit typescript entry fall back to the top-level fields', () => {
    const config = defineConfig({
      testPatterns: ['**/*.spec.ts'],
      mutation: { include: ['lib/**/*.ts'] },
      languages: { typescript: { mutation: { exclude: ['lib/vendor/**'] } } },
    })
    const [language] = resolveLanguages(config)
    expect(language.source).toBe('languages')
    expect(language.testPatterns).toEqual(['**/*.spec.ts'])
    expect(language.mutation.include).toEqual(['lib/**/*.ts'])
    expect(language.mutation.exclude).toEqual(['lib/vendor/**'])
  })

  it('fills other languages from their adapter defaults', () => {
    register()
    const config = defineConfig({ languages: { stub: {} } })
    const [language] = resolveLanguages(config)
    expect(language.id).toBe('stub')
    expect(language.testPatterns).toEqual(['**/*.stub'])
    expect(language.mutation).toEqual({ enabled: true, include: ['**/*.stubsrc'], exclude: [] })
  })

  it('drops the implicit typescript language once languages are listed', () => {
    register()
    const config = defineConfig({ languages: { stub: {} } })
    expect(resolveLanguages(config).map(l => l.id)).toEqual(['stub'])
  })

  it('fails closed on a configured language with no adapter', () => {
    const config = defineConfig({ languages: { cobol: {} } })
    expect(() => resolveLanguages(config)).toThrow(/No adapter registered for language 'cobol'/)
  })

  it('keeps disabled languages so callers can see them', () => {
    register()
    const config = defineConfig({ languages: { stub: { enabled: false } } })
    expect(resolveLanguages(config)[0].enabled).toBe(false)
  })
})

describe('languageForFile', () => {
  it('selects the language whose test patterns match the path', () => {
    register()
    const languages = resolveLanguages(defineConfig({ languages: { typescript: {}, stub: {} } }))
    expect(languageForFile('src/a.test.ts', languages)?.id).toBe('typescript')
    expect(languageForFile('pkg/b.stub', languages)?.id).toBe('stub')
  })

  it('returns null for a file no language claims', () => {
    const languages = resolveLanguages(defineConfig({}))
    expect(languageForFile('README.md', languages)).toBeNull()
    expect(languageForFile('src/a.ts', languages)).toBeNull()
  })

  it('ignores disabled languages', () => {
    register()
    const languages = resolveLanguages(defineConfig({ languages: { stub: { enabled: false } } }))
    expect(languageForFile('pkg/b.stub', languages)).toBeNull()
  })
})
