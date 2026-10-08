import { describe, it, expect } from 'vitest'
import { protectedMessage, protectionFor } from './protected.js'

describe('protectionFor', () => {
  const patterns = ['**/*.test.ts', '**/*_test.dart']

  it('is protected only when the path is a test that exists on the branch', async () => {
    await expect(protectionFor('src/a.test.ts', patterns, async () => true)).resolves.toBe('protected')
    await expect(protectionFor('src/a.test.ts', patterns, async () => false)).resolves.toBe('unprotected')
    await expect(protectionFor('src/a.ts', patterns, async () => true)).resolves.toBe('not-a-test')
    await expect(protectionFor('test/widget_test.dart', patterns, async () => true)).resolves.toBe('protected')
  })
})

describe('protectedMessage', () => {
  it('names the file and the branch', () => {
    expect(protectedMessage('src/a.test.ts', 'main')).toContain('src/a.test.ts')
    expect(protectedMessage('src/a.test.ts', 'main')).toContain('main')
  })
})
