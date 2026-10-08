import { describe, expect, it } from 'vitest'
import { defaultConfig, defineConfig } from '../config/schema.js'
import { classifyStaged, runPreCommit } from './pre-commit.js'

describe('classifyStaged extensions', () => {
  it('treats js and jsx tests as tests, and go and dart sources as implementation', () => {
    expect(classifyStaged([
      'src/Button.test.tsx',
      'src/Button.spec.jsx',
      'src/form.test.js',
      'src/form.test.mjs',
      'src/__tests__/Button.tsx',
      'src/Button.tsx',
      'src/form.js',
      'pkg/add_test.go',
      'pkg/add.go',
      'lib/add_test.dart',
      'lib/add.dart',
      'README.md',
    ], defaultConfig.testPatterns)).toEqual({
      tests: [
        'src/Button.test.tsx',
        'src/Button.spec.jsx',
        'src/form.test.js',
        'src/form.test.mjs',
        'src/__tests__/Button.tsx',
        'pkg/add_test.go',
        'lib/add_test.dart',
      ],
      impl: ['src/Button.tsx', 'src/form.js', 'pkg/add.go', 'lib/add.dart'],
      config: [],
    })
  })
})

describe('runPreCommit extensions', () => {
  const env = {}

  it('blocks a go test staged with its source', async () => {
    const result = await runPreCommit(defaultConfig, {
      staged: ['pkg/add.go', 'pkg/add_test.go'],
      commitMessage: '',
      env,
      protectedPaths: [],
    })
    expect(result.exitCode).toBe(1)
    expect(result.message.includes('pkg/add.go')).toBe(true)
    expect(result.message.includes('pkg/add_test.go')).toBe(true)
  })

  it('blocks a dart test staged with its source', async () => {
    const result = await runPreCommit(defaultConfig, {
      staged: ['lib/add.dart', 'lib/add_test.dart'],
      commitMessage: '',
      env,
      protectedPaths: [],
    })
    expect(result.exitCode).toBe(1)
    expect(result.message.includes('lib/add.dart')).toBe(true)
    expect(result.message.includes('lib/add_test.dart')).toBe(true)
  })

  it('uses a language test pattern that the top-level list does not have', async () => {
    const config = defineConfig({ languages: { go: { testPatterns: ['**/*.gittest'] } } })
    const result = await runPreCommit(config, {
      staged: ['pkg/add.go', 'pkg/add.gittest'],
      commitMessage: '',
      env,
      protectedPaths: [],
    })
    expect(result.exitCode).toBe(1)
    expect(result.message.includes('pkg/add.gittest')).toBe(true)
  })
})
