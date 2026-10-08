import { describe, it, expect } from 'vitest'
import { parseArgs, type CliCommand } from './commands.js'

describe('parseArgs', () => {
  it('parses check command', () => {
    const result = parseArgs(['check'])
    expect(result).toEqual({ command: 'check', flags: {} })
  })

  it('parses check with --mutation flag', () => {
    const result = parseArgs(['check', '--mutation'])
    expect(result).toEqual({ command: 'check', flags: { mutation: true } })
  })

  it('parses check with --semantic flag', () => {
    const result = parseArgs(['check', '--semantic'])
    expect(result).toEqual({ command: 'check', flags: { semantic: true } })
  })

  it('parses check with multiple flags', () => {
    const result = parseArgs(['check', '--mutation', '--semantic'])
    expect(result).toEqual({ command: 'check', flags: { mutation: true, semantic: true } })
  })

  it('parses score command', () => {
    const result = parseArgs(['score'])
    expect(result).toEqual({ command: 'score', flags: {} })
  })

  it('parses report command', () => {
    const result = parseArgs(['report'])
    expect(result).toEqual({ command: 'report', flags: {} })
  })

  it('parses status command', () => {
    expect(parseArgs(['status'])).toEqual({ command: 'status', flags: {} })
  })

  it('parses init command', () => {
    const result = parseArgs(['init'])
    expect(result).toEqual({ command: 'init', flags: {} })
  })

  it('returns help for no arguments', () => {
    const result = parseArgs([])
    expect(result).toEqual({ command: 'help', flags: {} })
  })

  it('returns help for unknown commands', () => {
    const result = parseArgs(['foobar'])
    expect(result).toEqual({ command: 'help', flags: {} })
  })

  it('parses --threshold flag with value', () => {
    const result = parseArgs(['check', '--threshold', '90'])
    expect(result).toEqual({ command: 'check', flags: { threshold: 90 } })
  })

  it('parses --base with a ref', () => {
    expect(parseArgs(['check', '--base', 'origin/main'])).toEqual({ command: 'check', flags: { base: 'origin/main' } })
  })

  it('parses check --hook', () => {
    expect(parseArgs(['check', '--hook'])).toEqual({ command: 'check', flags: { hook: true } })
  })

  it('parses protected --file', () => {
    expect(parseArgs(['protected', '--file', 'src/a.test.ts'])).toEqual({
      command: 'protected',
      flags: { file: 'src/a.test.ts' },
    })
  })
})
