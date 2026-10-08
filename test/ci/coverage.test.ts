import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf-8')
const config = readFileSync(new URL('../../vitest.config.ts', import.meta.url), 'utf-8')

const COVERAGE = 'npx vitest run --coverage'
const CHECK = 'node dist/bin/vibecheck.js check --semantic --base'

function jobContaining(yaml: string, needle: string): string {
  const jobs = yaml.split(/\n(?=  [^ \n]+:\n)/)
  const job = jobs.find(part => part.includes(needle))
  if (!job) throw new Error(`no job contains ${needle}`)
  return job
}

describe('dogfood coverage', () => {
  it('runs coverage in the same job as the dogfood check', () => {
    expect(workflow.split(COVERAGE)).toHaveLength(2)
    const job = jobContaining(workflow, COVERAGE)
    expect(job.includes(CHECK)).toBe(true)
    expect(job.includes('node-version: [18, 20, 22]')).toBe(false)
  })

  it('warms the Go parser cache before coverage', () => {
    const job = jobContaining(workflow, COVERAGE)
    expect(job.includes('working-directory: helpers/go-testast')).toBe(true)
    expect(job.includes('go build -o /tmp/vibecheck-go-testast .')).toBe(true)
    expect(job.includes('setup-go')).toBe(false)
  })

  it('fails the run when src coverage drops under the floor', () => {
    expect(config.includes('all: true')).toBe(true)
    expect(config.includes("include: ['src/**/*.ts']")).toBe(true)
    expect(config.includes('lines: 95')).toBe(true)
    expect(config.includes('statements: 95')).toBe(true)
    expect(config.includes('functions: 93')).toBe(true)
    expect(config.includes('branches: 88')).toBe(true)
  })
})
