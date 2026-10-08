import { describe, it, expect } from 'vitest'
import { collectStatus, formatStatus } from './status.js'

describe('collectStatus', () => {
  it('marks files that exist on the protected branch, and ignores non-tests', async () => {
    const files = await collectStatus(
      ['src/a.test.ts', 'src/b.test.ts', 'src/a.ts', 'README.md'],
      ['**/*.test.ts'],
      async file => file === 'src/a.test.ts',
    )
    expect(files).toEqual([
      { path: 'src/a.test.ts', state: 'protected' },
      { path: 'src/b.test.ts', state: 'new' },
    ])
  })
})

describe('formatStatus', () => {
  it('groups by directory and labels protection', () => {
    const text = formatStatus([
      { path: 'src/core/validator.test.ts', state: 'protected' },
      { path: 'src/core/new.test.ts', state: 'new' },
      { path: 'top.test.ts', state: 'new' },
    ])
    expect(text).toContain('src/core/')
    expect(text).toContain('protected  validator.test.ts')
    expect(text).toContain('new        new.test.ts')
    expect(text).toContain('(repo root)')
    expect(text).toContain('new        top.test.ts')
  })

  it('says so when nothing matches', () => {
    expect(formatStatus([])).toContain('no test files')
  })
})
