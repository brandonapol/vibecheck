import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(new URL('../../.github/workflows/publish.yml', import.meta.url), 'utf-8')

const WARM = 'go build -o /tmp/vibecheck-go-testast .'

describe('release publish', () => {
  it('warms the Go parser cache before npm test', () => {
    const warmAt = workflow.indexOf(WARM)
    const testAt = workflow.indexOf('npm test')
    expect(warmAt).toBeGreaterThan(-1)
    expect(testAt).toBeGreaterThan(warmAt)
    expect(workflow.includes('working-directory: helpers/go-testast')).toBe(true)
  })
})
