import { describe, it, expect } from 'vitest'
import { calculateScore, type AnalyzerResults, type Weights } from './score.js'

const defaultWeights: Weights = {
  mutation: 40,
  semanticDiff: 10,
  hiddenTests: 30,
  propertyTests: 20,
}

describe('calculateScore', () => {
  it('calculates a perfect score when all analyzers pass', () => {
    const results: AnalyzerResults = {
      mutation: { score: 100, enabled: true },
      semanticDiff: { weakeningRate: 0, enabled: true },
      hiddenTests: { passRate: 100, enabled: true },
      propertyTests: { coverage: 100, enabled: true },
    }
    const score = calculateScore(results, defaultWeights)
    expect(score.total).toBe(100)
  })

  it('calculates weighted score correctly', () => {
    const results: AnalyzerResults = {
      mutation: { score: 80, enabled: true },
      semanticDiff: { weakeningRate: 0, enabled: true },
      hiddenTests: { passRate: 60, enabled: true },
      propertyTests: { coverage: 50, enabled: true },
    }
    const score = calculateScore(results, defaultWeights)
    // (40*80 + 10*100 + 30*60 + 20*50) / 100 = (3200 + 1000 + 1800 + 1000) / 100 = 70
    expect(score.total).toBe(70)
  })

  it('excludes disabled analyzers from weight calculation', () => {
    const results: AnalyzerResults = {
      mutation: { score: 80, enabled: true },
      semanticDiff: { weakeningRate: 0, enabled: true },
      hiddenTests: { passRate: 0, enabled: false },
      propertyTests: { coverage: 0, enabled: false },
    }
    const score = calculateScore(results, defaultWeights)
    // Only mutation (40) and semantic (10) are active, total weight = 50
    // (40*80 + 10*100) / 50 = (3200 + 1000) / 50 = 84
    expect(score.total).toBe(84)
  })

  it('returns 100 when no analyzers are enabled', () => {
    const results: AnalyzerResults = {
      mutation: { score: 0, enabled: false },
      semanticDiff: { weakeningRate: 1, enabled: false },
      hiddenTests: { passRate: 0, enabled: false },
      propertyTests: { coverage: 0, enabled: false },
    }
    const score = calculateScore(results, defaultWeights)
    expect(score.total).toBe(100)
  })

  it('converts semantic diff weakening rate to a score', () => {
    const results: AnalyzerResults = {
      mutation: { score: 100, enabled: false },
      semanticDiff: { weakeningRate: 0.3, enabled: true },
      hiddenTests: { passRate: 0, enabled: false },
      propertyTests: { coverage: 0, enabled: false },
    }
    const score = calculateScore(results, defaultWeights)
    // semanticDiff score = (1 - 0.3) * 100 = 70
    expect(score.total).toBe(70)
  })

  it('provides per-component breakdown', () => {
    const results: AnalyzerResults = {
      mutation: { score: 85, enabled: true },
      semanticDiff: { weakeningRate: 0.1, enabled: true },
      hiddenTests: { passRate: 75, enabled: false },
      propertyTests: { coverage: 60, enabled: false },
    }
    const score = calculateScore(results, defaultWeights)
    expect(score.components.mutation).toBe(85)
    expect(score.components.semanticDiff).toBe(90)
    expect(score.components.hiddenTests).toBeUndefined()
    expect(score.components.propertyTests).toBeUndefined()
  })

  it('rounds total to nearest integer', () => {
    const results: AnalyzerResults = {
      mutation: { score: 83, enabled: true },
      semanticDiff: { weakeningRate: 0, enabled: true },
      hiddenTests: { passRate: 0, enabled: false },
      propertyTests: { coverage: 0, enabled: false },
    }
    const score = calculateScore(results, defaultWeights)
    // (40*83 + 10*100) / 50 = (3320 + 1000) / 50 = 86.4
    expect(score.total).toBe(86)
  })
})
