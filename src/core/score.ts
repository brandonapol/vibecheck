export type Weights = {
  mutation: number
  semanticDiff: number
  hiddenTests: number
  propertyTests: number
}

export type AnalyzerResults = {
  mutation: { score: number; enabled: boolean; ran?: boolean }
  semanticDiff: { weakeningRate: number; enabled: boolean; ran?: boolean }
  hiddenTests: { passRate: number; enabled: boolean; ran?: boolean }
  propertyTests: { coverage: number; enabled: boolean; ran?: boolean }
}

export type AnalyzerName = keyof AnalyzerResults

export type IntegrityScore = {
  total: number
  components: {
    mutation?: number
    semanticDiff?: number
    hiddenTests?: number
    propertyTests?: number
  }
  skipped?: AnalyzerName[]
}

export function calculateScore(results: AnalyzerResults, weights: Weights): IntegrityScore {
  const components: IntegrityScore['components'] = {}
  const skipped: AnalyzerName[] = []
  let weightedSum = 0
  let totalWeight = 0

  const applyAnalyzer = (name: AnalyzerName, enabled: boolean, ran: boolean | undefined, score: number, weight: number) => {
    if (!enabled) return
    if (ran === false) {
      skipped.push(name)
      return
    }
    components[name] = score
    weightedSum += weight * score
    totalWeight += weight
  }

  applyAnalyzer('mutation', results.mutation.enabled, results.mutation.ran, results.mutation.score, weights.mutation)
  applyAnalyzer(
    'semanticDiff',
    results.semanticDiff.enabled,
    results.semanticDiff.ran,
    (1 - results.semanticDiff.weakeningRate) * 100,
    weights.semanticDiff,
  )
  applyAnalyzer('hiddenTests', results.hiddenTests.enabled, results.hiddenTests.ran, results.hiddenTests.passRate, weights.hiddenTests)
  applyAnalyzer('propertyTests', results.propertyTests.enabled, results.propertyTests.ran, results.propertyTests.coverage, weights.propertyTests)

  const total = totalWeight === 0 ? 0 : Math.round(weightedSum / totalWeight)

  return { total, components, skipped }
}
