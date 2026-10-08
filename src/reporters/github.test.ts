import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { githubAnnotationLines } from './github.js'

describe('github annotations', () => {
  it('prints one error line per failure when the run is GitHub Actions', () => {
    expect(githubAnnotationLines(
      ['Integrity score 70 is below the threshold of 80', 'line\n two'],
      { GITHUB_ACTIONS: 'true' },
    )).toEqual([
      '::error::Integrity score 70 is below the threshold of 80',
      '::error::line two',
    ])
  })

  it('prints nothing when the check passed or the run is local', () => {
    expect(githubAnnotationLines([], { GITHUB_ACTIONS: 'true' })).toEqual([])
    expect(githubAnnotationLines(['a failure'], {})).toEqual([])
  })

  it('is what the CLI writes', () => {
    const bin = readFileSync(new URL('../../bin/vibecheck.ts', import.meta.url), 'utf-8')
    expect(bin.includes('githubAnnotationLines')).toBe(true)
  })
})
