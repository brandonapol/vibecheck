import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defineConfig, defaultConfig } from '../config/schema.js'
import { patternsForConfig } from './test-patterns.js'

describe('patternsForConfig', () => {
  it('keeps the top-level list when no languages are configured', () => {
    expect(patternsForConfig(defaultConfig)).toEqual(defaultConfig.testPatterns)
  })

  it('uses the enabled language patterns and drops a disabled language', () => {
    const config = defineConfig({
      languages: {
        go: { testPatterns: ['**/*.gittest'] },
        dart: { enabled: false, testPatterns: ['**/*.darttest'] },
      },
    })
    expect(patternsForConfig(config)).toEqual(['**/*.gittest'])
  })

  it('is what status and protected use', () => {
    const bin = readFileSync(new URL('../../bin/vibecheck.ts', import.meta.url), 'utf-8')
    expect(bin.includes('patternsForConfig')).toBe(true)
  })
})
