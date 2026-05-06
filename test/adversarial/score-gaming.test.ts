import { describe, it, expect } from 'vitest'
import { calculateScore, type AnalyzerResults, type Weights } from '../../src/core/score.js'

const defaultWeights: Weights = {
  mutation: 40,
  semanticDiff: 10,
  hiddenTests: 30,
  propertyTests: 20,
}

/**
 * ADVERSARIAL TESTS: Attempts to game the composite score calculation.
 * Each passing test documents a way to achieve a high score without good tests.
 */

describe('Score Gaming Attacks', () => {

  // =========================================================================
  // ATTACK 1: Disable hard analyzers to inflate score
  // Strategy: If hidden tests and property tests are disabled (the v0.1 default),
  // only mutation (40%) and semantic diff (10%) are active. Total weight = 50.
  // A mediocre mutation score still passes because the denominator shrinks.
  // =========================================================================
  describe('ATTACK: Disable analyzers to inflate score', () => {
    it('LOOPHOLE: with only mutation+semantic enabled, 70% mutation score = 82 total', () => {
      const results: AnalyzerResults = {
        mutation: { score: 70, enabled: true },
        semanticDiff: { weakeningRate: 0, enabled: true },
        hiddenTests: { passRate: 0, enabled: false },
        propertyTests: { coverage: 0, enabled: false },
      }
      const score = calculateScore(results, defaultWeights)
      // (40*70 + 10*100) / 50 = (2800 + 1000) / 50 = 76
      // A 70% mutation score (mediocre) becomes a 76 total — close to passing 80 threshold
      expect(score.total).toBe(76)
    })

    it('LOOPHOLE: semantic diff alone gives free 100 if no violations exist', () => {
      const results: AnalyzerResults = {
        mutation: { score: 0, enabled: false },
        semanticDiff: { weakeningRate: 0, enabled: true },
        hiddenTests: { passRate: 0, enabled: false },
        propertyTests: { coverage: 0, enabled: false },
      }
      const score = calculateScore(results, defaultWeights)
      // Only semantic diff is active: (10 * 100) / 10 = 100
      // Agent can get a perfect score by ONLY enabling semantic diff and not touching tests
      expect(score.total).toBe(100) // LOOPHOLE: perfect score with zero test quality
    })

    it('LOOPHOLE: disabling ALL analyzers returns 100 by default', () => {
      const results: AnalyzerResults = {
        mutation: { score: 0, enabled: false },
        semanticDiff: { weakeningRate: 1, enabled: false },
        hiddenTests: { passRate: 0, enabled: false },
        propertyTests: { coverage: 0, enabled: false },
      }
      const score = calculateScore(results, defaultWeights)
      expect(score.total).toBe(100) // LOOPHOLE: no checks = perfect score
    })
  })

  // =========================================================================
  // ATTACK 2: Game semantic diff weight
  // Strategy: Semantic diff is only 10% weight. Even with massive weakening,
  // it barely impacts the total score. The agent can weaken assertions freely
  // and still pass if mutation score is decent.
  // =========================================================================
  describe('ATTACK: Semantic diff weight is negligible', () => {
    it('LOOPHOLE: 100% weakening rate only costs 10 points', () => {
      const results: AnalyzerResults = {
        mutation: { score: 90, enabled: true },
        semanticDiff: { weakeningRate: 1.0, enabled: true }, // Total weakening!
        hiddenTests: { passRate: 0, enabled: false },
        propertyTests: { coverage: 0, enabled: false },
      }
      const score = calculateScore(results, defaultWeights)
      // (40*90 + 10*0) / 50 = 3600 / 50 = 72
      // Even with TOTAL assertion weakening, score is still 72
      expect(score.total).toBe(72)
    })
  })

  // =========================================================================
  // ATTACK 3: Config manipulation
  // Strategy: If the agent can modify vibecheck.config.ts (which it can, since
  // it's just a file in the repo), it can change thresholds, disable analyzers,
  // or exclude files from mutation testing.
  // =========================================================================
  describe('ATTACK: Config is not protected', () => {
    it('DESIGN FLAW: agent can lower threshold in config to make any score pass', () => {
      // The agent could change vibecheck.config.ts:
      //   mutation: { threshold: 10 } // was 80
      // This is a social/process issue, not a code bug, but the tool doesn't
      // detect or prevent config weakening.
      expect(true).toBe(true) // Documented as design flaw
    })

    it('DESIGN FLAW: agent can add source files to exclude list to avoid mutation', () => {
      // The agent could add critical files to the exclude list:
      //   mutation: { exclude: ['src/payments/**'] }
      // Stryker would skip those files entirely.
      expect(true).toBe(true) // Documented as design flaw
    })
  })
})
