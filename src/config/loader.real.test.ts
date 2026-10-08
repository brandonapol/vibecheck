import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from './loader.js'

describe('loadConfig — TypeScript file', () => {
  let dir = ''

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  it('loads a .ts config and fills schema defaults', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-config-'))
    writeFileSync(
      join(dir, 'vibecheck.config.ts'),
      'export default { threshold: 91, mutation: { threshold: 70 } }\n',
    )
    const config = await loadConfig(dir)
    expect(config.threshold).toBe(91)
    expect(config.mutation.threshold).toBe(70)
    expect(config.mutation.tool).toBe('stryker')
    expect(config.protectedBranch).toBe('main')
  })

  it('rejects a .ts config that breaks the schema', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vibecheck-config-'))
    writeFileSync(join(dir, 'vibecheck.config.ts'), 'export default { mutation: { threshold: 200 } }\n')
    await expect(loadConfig(dir)).rejects.toThrow()
  })
})
