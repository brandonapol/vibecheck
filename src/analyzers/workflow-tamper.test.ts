import { describe, expect, it } from 'vitest'
import { detectTamper, tamperCandidate } from './tamper.js'

describe('workflow tamper', () => {
  it('reports a ci.yml edit without failing the check', () => {
    const violations = detectTamper([{
      file: '.github/workflows/ci.yml',
      before: 'run: node dist/bin/vibecheck.js check --semantic\n',
      after: 'run: echo skipped\n',
    }])
    expect(violations).toEqual([
      {
        file: '.github/workflows/ci.yml',
        kind: 'workflow-drift',
        blocking: false,
        detail: 'vibecheck workflow changed (reported only; branch protection decides whether CI can be edited)',
      },
    ])
  })

  it('reports a .yaml workflow and ignores a template', () => {
    expect(tamperCandidate('.github/workflows/ci.yaml')).toBe(true)
    expect(tamperCandidate('.github/workflows/ci.yml')).toBe(true)
    const template = detectTamper([{
      file: 'templates/github-actions.yml',
      before: 'run: npx vibecheck check\n',
      after: 'run: echo skipped\n',
    }])
    expect(template).toEqual([])
  })
})
