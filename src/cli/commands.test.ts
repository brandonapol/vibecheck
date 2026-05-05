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
})
