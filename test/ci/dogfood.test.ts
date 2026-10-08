import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf-8')

const COMMAND =
  "node dist/bin/vibecheck.js check --semantic --base origin/${{ github.base_ref || 'main' }}"

/** Top-level job blocks in the workflow, each starting at a two-space key. */
function jobContaining(yaml: string, needle: string): string {
  const jobs = yaml.split(/\n(?=  [^ \n]+:\n)/)
  const job = jobs.find(part => part.includes(needle))
  if (!job) throw new Error(`no job contains ${needle}`)
  return job
}

describe('dogfood CI', () => {
  it('runs the built CLI once, against the base ref, with full history', () => {
    expect(workflow.split(COMMAND)).toHaveLength(2)
    const job = jobContaining(workflow, COMMAND)
    expect(job).toContain('fetch-depth: 0')
    expect(job).toContain('npm ci')
    expect(job).toContain('npm run build')
    expect(job).not.toContain('node-version: [18, 20, 22]')
    expect(job).not.toMatch(/setup-go|setup-dart|gremlins/)
  })
})
