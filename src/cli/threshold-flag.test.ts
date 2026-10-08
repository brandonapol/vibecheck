import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assertThreshold, parseArgs } from './commands.js'

function messageFor(value: number | undefined): string {
  try {
    assertThreshold(value)
    return ''
  } catch (err) {
    return (err as Error).message
  }
}

describe('assertThreshold', () => {
  it('accepts a number from 0 to 100', () => {
    expect(messageFor(0)).toBe('')
    expect(messageFor(90)).toBe('')
    expect(messageFor(100)).toBe('')
    expect(parseArgs(['check', '--threshold', '90']).flags.threshold).toBe(90)
  })

  it('rejects a value the score comparison would ignore', () => {
    const error = 'vibecheck: --threshold must be a number from 0 to 100'
    expect(messageFor(Number.NaN)).toBe(error)
    expect(messageFor(101)).toBe(error)
    expect(messageFor(-1)).toBe(error)
    expect(messageFor(Number.POSITIVE_INFINITY)).toBe(error)
    expect(Number.isNaN(parseArgs(['check', '--threshold', 'nope']).flags.threshold)).toBe(true)
  })

  it('is what the CLI checks before the score gate', () => {
    const bin = readFileSync(new URL('../../bin/vibecheck.ts', import.meta.url), 'utf-8')
    expect(bin.includes('assertThreshold')).toBe(true)
  })
})
