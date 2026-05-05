export type Weights = {
  mutation: number
  semanticDiff: number
  hiddenTests: number
  propertyTests: number
}

export type AnalyzerResults = {
  mutation: { score: number; enabled: boolean }
  semanticDiff: { weakeningRate: number; enabled: boolean }
  hiddenTests: { passRate: number; enabled: boolean }
  propertyTests: { coverage: number; enabled: boolean }
}

export type IntegrityScore = {
  total: number
  components: {
    mutation?: number
    semanticDiff?: number
    hiddenTests?: number
    propertyTests?: number
  }
}

export function calculateScore(results: AnalyzerResults, weights: Weights): IntegrityScore {
  const components: IntegrityScore['components'] = {}
  let weightedSum = 0
  let totalWeight = 0

  if (results.mutation.enabled) {
    components.mutation = results.mutation.score
    weightedSum += weights.mutation * results.mutation.score
    totalWeight += weights.mutation
  }

  if (results.semanticDiff.enabled) {
    const semanticScore = (1 - results.semanticDiff.weakeningRate) * 100
    components.semanticDiff = semanticScore
    weightedSum += weights.semanticDiff * semanticScore
    totalWeight += weights.semanticDiff
  }

  if (results.hiddenTests.enabled) {
    components.hiddenTests = results.hiddenTests.passRate
    weightedSum += weights.hiddenTests * results.hiddenTests.passRate
    totalWeight += weights.hiddenTests
  }

  if (results.propertyTests.enabled) {
    components.propertyTests = results.propertyTests.coverage
    weightedSum += weights.propertyTests * results.propertyTests.coverage
    totalWeight += weights.propertyTests
  }

  const total = totalWeight === 0 ? 100 : Math.round(weightedSum / totalWeight)

  return { total, components }
}
