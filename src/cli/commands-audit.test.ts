import { describe, expect, it } from 'vitest'
import { parseArgs } from './commands.js'

describe('audit command', () => {
  it('parses a history scan and an optional start ref', () => {
    expect(parseArgs(['audit'])).toEqual({ command: 'audit', flags: {} })
    expect(parseArgs(['audit', '--since', 'origin/main'])).toEqual({
      command: 'audit',
      flags: { since: 'origin/main' },
    })
  })
})
