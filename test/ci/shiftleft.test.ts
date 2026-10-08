import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf-8')

function jobContaining(yaml: string, needle: string): string {
  const jobs = yaml.split(/\n(?=  [^ \n]+:\n)/)
  const job = jobs.find(part => part.includes(needle))
  if (!job) throw new Error(`no job contains ${needle}`)
  return job
}

describe('ShiftLeft scan', () => {
  it('runs beside the dogfood job on the same CI workflow', () => {
    const job = jobContaining(workflow, 'ShiftLeftSecurity/scan-action@v1.3.0')
    expect(job).toContain('type: nodejs,go,credscan,depscan')
    expect(job).not.toContain('node dist/bin/vibecheck.js')
    expect(workflow).toContain('node dist/bin/vibecheck.js check --semantic --base')
  })
})
