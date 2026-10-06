import { describe, it, expect } from 'vitest'
import { execaSync } from 'execa'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGoAdapter, goAdapter, GO_ASSERTION_STRENGTH } from './go.js'
import { getAdapter } from './registry.js'

const hasGo = (() => {
  try {
    execaSync('go', ['version'])
    return true
  } catch {
    return false
  }
})()

const SOURCE = `package sum

import "testing"

func TestSum(t *testing.T) {
	if got := Sum(1, 2); got != 3 {
		t.Errorf("got %d", got)
	}
}
`

describe('goAdapter', () => {
  it('is registered as go', () => {
    expect(getAdapter('go')).toBe(goAdapter)
  })

  it('defaults to Go test files and Go sources', () => {
    expect(goAdapter.testPatterns).toEqual(['**/*_test.go'])
    expect(goAdapter.sourcePatterns).toEqual(['**/*.go'])
  })

  it('ranks Go comparisons on the shared scale', () => {
    expect(goAdapter.assertionStrength('equal')).toBe(10)
    expect(goAdapter.assertionStrength('deepEqual')).toBe(10)
    expect(goAdapter.assertionStrength('length')).toBe(8)
    expect(goAdapter.assertionStrength('errorIs')).toBe(7)
    expect(goAdapter.assertionStrength('noError')).toBe(6)
    expect(goAdapter.assertionStrength('anyError')).toBe(4)
    expect(goAdapter.assertionStrength('truthy')).toBe(3)
    expect(goAdapter.assertionStrength('notNil')).toBe(2)
  })

  it('ranks testify matchers like their Jest counterparts', () => {
    expect(GO_ASSERTION_STRENGTH.Equal).toBe(9)
    expect(GO_ASSERTION_STRENGTH.Exactly).toBe(10)
    expect(GO_ASSERTION_STRENGTH.NotNil).toBe(2)
    expect(GO_ASSERTION_STRENGTH.ErrorIs).toBe(7)
    expect(GO_ASSERTION_STRENGTH.Error).toBe(4)
  })

  it('treats an unknown helper as neutral', () => {
    expect(goAdapter.assertionStrength('checkSum')).toBe(5)
  })

  it('has no mutation engine yet', () => {
    expect(goAdapter.runMutation).toBeUndefined()
  })
})

describe.skipIf(!hasGo)('goAdapter extraction (requires go)', () => {
  it('extracts tests through the helper', async () => {
    const tests = await goAdapter.extractTests(SOURCE, 'sum_test.go')
    expect(tests.map(t => t.id)).toEqual(['TestSum'])
    expect(tests[0].assertions.map(a => a.matcher)).toEqual(['equal'])
  })

  it('extracts setup through the helper', async () => {
    expect(await goAdapter.extractSetup(SOURCE, 'sum_test.go')).toEqual([])
  })

  it('fails closed on a file that does not parse', async () => {
    await expect(goAdapter.extractTests('package x\nfunc {', 'bad_test.go')).rejects.toThrow(/bad_test\.go/)
  })
})

describe('goAdapter without a Go toolchain', () => {
  it('fails closed with a message naming the missing tool', async () => {
    const adapter = createGoAdapter({
      goBinary: 'go-does-not-exist-vibecheck',
      cacheDir: mkdtempSync(join(tmpdir(), 'vibecheck-nogo-')),
    })
    await expect(adapter.extractTests(SOURCE, 'sum_test.go')).rejects.toThrow(/Go toolchain/)
  })
})
