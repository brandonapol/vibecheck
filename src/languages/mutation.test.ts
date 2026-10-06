import { describe, it, expect, afterEach, vi } from 'vitest'
import { runMutationForLanguages } from './mutation.js'
import { registerAdapter } from './registry.js'
import { defineConfig } from '../config/schema.js'
import type { CountedMutationReport } from '../analyzers/mutation.js'
import { makeStubAdapter } from '../../test/__tests__/stub-adapter.js'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function report(file: string, killed: number, total: number): CountedMutationReport {
  return {
    overallScore: total === 0 ? 100 : (killed / total) * 100,
    fileScores: { [file]: total === 0 ? 100 : (killed / total) * 100 },
    survivingMutants: [],
    killed,
    total,
  }
}

describe('runMutationForLanguages', () => {
  it('runs each enabled language and merges the reports', async () => {
    const stubRun = vi.fn(async () => report('a.stubsrc', 1, 4))
    const otherRun = vi.fn(async () => report('b.other', 4, 4))
    cleanups.push(registerAdapter(makeStubAdapter({ runMutation: stubRun })))
    cleanups.push(registerAdapter(makeStubAdapter({ id: 'other', runMutation: otherRun })))

    const merged = await runMutationForLanguages(defineConfig({ languages: { stub: {}, other: {} } }))

    expect(merged.killed).toBe(5)
    expect(merged.total).toBe(8)
    expect(merged.overallScore).toBe(62.5)
    expect(merged.fileScores).toEqual({ 'a.stubsrc': 25, 'b.other': 100 })
  })

  it('passes the resolved include and exclude to the adapter', async () => {
    const run = vi.fn(async () => report('a.stubsrc', 1, 1))
    cleanups.push(registerAdapter(makeStubAdapter({ runMutation: run })))

    await runMutationForLanguages(
      defineConfig({ protectedBranch: 'trunk', languages: { stub: { mutation: { exclude: ['gen/**'] } } } }),
    )

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ include: ['**/*.stubsrc'], exclude: ['gen/**'], protectedBranch: 'trunk' }),
    )
  })

  it('skips disabled languages and languages with mutation disabled', async () => {
    const run = vi.fn(async () => report('a.stubsrc', 1, 1))
    cleanups.push(registerAdapter(makeStubAdapter({ runMutation: run })))
    cleanups.push(registerAdapter(makeStubAdapter({ id: 'other', runMutation: run })))

    await runMutationForLanguages(
      defineConfig({ languages: { stub: { enabled: false }, other: { mutation: { enabled: false } } } }),
    )

    expect(run).not.toHaveBeenCalled()
  })

  it('fails closed when a language has mutation enabled but its adapter cannot mutate', async () => {
    cleanups.push(registerAdapter(makeStubAdapter()))

    await expect(runMutationForLanguages(defineConfig({ languages: { stub: {} } }))).rejects.toThrow(
      /languages\.stub\.mutation\.enabled/,
    )
  })

  it('propagates an adapter failure instead of scoring it', async () => {
    cleanups.push(
      registerAdapter(makeStubAdapter({ runMutation: async () => { throw new Error('engine crashed') } })),
    )

    await expect(runMutationForLanguages(defineConfig({ languages: { stub: {} } }))).rejects.toThrow('engine crashed')
  })
})
