import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('pre-commit hook script', () => {
  it('delegates to vibecheck check --hook', () => {
    const script = readFileSync(join(__dirname, '../../hooks/pre-commit'), 'utf-8')
    expect(script.startsWith('#!/bin/sh')).toBe(true)
    expect(script).toContain('npx --no-install vibecheck check --hook')
  })
})
