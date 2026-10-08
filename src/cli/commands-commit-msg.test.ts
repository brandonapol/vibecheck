import { describe, expect, it } from 'vitest'
import { parseArgs } from './commands.js'

describe('commit-msg command', () => {
  it('parses the message file', () => {
    expect(parseArgs(['commit-msg', '--file', '.git/COMMIT_EDITMSG'])).toEqual({
      command: 'commit-msg',
      flags: { file: '.git/COMMIT_EDITMSG' },
    })
  })
})
