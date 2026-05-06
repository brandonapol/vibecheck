export type WeakeningPattern =
  | 'precision-reduction'
  | 'error-relaxation'
  | 'bound-loosening'
  | 'test-deletion'
  | 'skip-addition'
  | 'assertion-count-reduction'
  | 'tautological-assertion'

export type WeakeningViolation = {
  file: string
  pattern: WeakeningPattern
  detail: string
}

export const ASSERTION_STRENGTH: Record<string, number> = {
  toBe: 10,
  toEqual: 9,
  toStrictEqual: 10,
  toMatchObject: 7,
  toHaveLength: 8,
  toContain: 6,
  toContainEqual: 7,
  toBeTruthy: 3,
  toBeFalsy: 3,
  toBeDefined: 2,
  toBeUndefined: 2,
  toBeNull: 3,
  toBeNaN: 3,
  toBeInstanceOf: 6,
  toBeGreaterThan: 7,
  toBeGreaterThanOrEqual: 7,
  toBeLessThan: 7,
  toBeLessThanOrEqual: 7,
  toBeCloseTo: 8,
  toMatch: 6,
  toMatchSnapshot: 4,
  toMatchInlineSnapshot: 5,
  toHaveProperty: 6,
  toHaveBeenCalled: 4,
  toHaveBeenCalledWith: 8,
  toHaveBeenCalledTimes: 7,
  toHaveBeenLastCalledWith: 8,
  toHaveBeenNthCalledWith: 8,
  toHaveReturned: 4,
  toHaveReturnedWith: 8,
  toHaveReturnedTimes: 7,
  toThrow: 4,
  toThrowError: 7,
}

type TestBlock = {
  name: string
  assertions: string[]
  skipped: boolean
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

function extractTestBlocks(source: string): TestBlock[] {
  const blocks: TestBlock[] = []
  const testRegex = /\b(it|test)(\.skip|\.each\b[^)]*\))?\s*\(\s*(['"`])(.*?)\3/g
  let match: RegExpExecArray | null

  while ((match = testRegex.exec(source)) !== null) {
    const modifier = match[2] ?? ''
    const skipped = modifier === '.skip'
    const name = match[4]
    const startIdx = match.index

    let depth = 0
    let blockStart = -1
    for (let i = startIdx; i < source.length; i++) {
      if (source[i] === '{' && depth === 0) {
        blockStart = i
        depth = 1
      } else if (source[i] === '{') {
        depth++
      } else if (source[i] === '}') {
        depth--
        if (depth === 0) {
          const rawBody = source.slice(blockStart, i + 1)
          const body = stripComments(rawBody)
          const assertions = extractAssertionMethods(body)
          blocks.push({ name, assertions, skipped })
          break
        }
      }
    }
  }

  return blocks
}

const ALL_MATCHERS = Object.keys(ASSERTION_STRENGTH).join('|')
const ASSERTION_REGEX = new RegExp(`\\.(${ALL_MATCHERS})\\b`, 'g')

function extractAssertionMethods(body: string): string[] {
  const methods: string[] = []
  let match: RegExpExecArray | null
  ASSERTION_REGEX.lastIndex = 0
  while ((match = ASSERTION_REGEX.exec(body)) !== null) {
    methods.push(match[1])
  }
  return methods
}

function getAssertionStrength(method: string): number {
  return ASSERTION_STRENGTH[method] ?? 0
}

const TAUTOLOGY_PATTERN = /expect\(\s*(true|false|null|undefined|\d+|'[^']*'|"[^"]*")\s*\)\s*\.\s*(toBe|toEqual|toStrictEqual)\s*\(\s*(true|false|null|undefined|\d+|'[^']*'|"[^"]*")\s*\)/g

function countTautologies(body: string): number {
  TAUTOLOGY_PATTERN.lastIndex = 0
  let count = 0
  let match: RegExpExecArray | null
  while ((match = TAUTOLOGY_PATTERN.exec(body)) !== null) {
    count++
  }
  return count
}

export function detectWeakeningInDiff(
  before: string,
  after: string,
  file: string,
): WeakeningViolation[] {
  const violations: WeakeningViolation[] = []
  const beforeBlocks = extractTestBlocks(before)
  const afterBlocks = extractTestBlocks(after)

  const beforeByName = new Map(beforeBlocks.map(b => [b.name, b]))
  const afterByName = new Map(afterBlocks.map(b => [b.name, b]))

  for (const [name, beforeBlock] of beforeByName) {
    const afterBlock = afterByName.get(name)

    if (!afterBlock) {
      violations.push({
        file,
        pattern: 'test-deletion',
        detail: `Test "${name}" was deleted`,
      })
      continue
    }

    if (!beforeBlock.skipped && afterBlock.skipped) {
      violations.push({
        file,
        pattern: 'skip-addition',
        detail: `Test "${name}" was skipped`,
      })
      continue
    }

    if (afterBlock.assertions.length < beforeBlock.assertions.length) {
      violations.push({
        file,
        pattern: 'assertion-count-reduction',
        detail: `Test "${name}": assertions reduced from ${beforeBlock.assertions.length} to ${afterBlock.assertions.length}`,
      })
    }

    for (let i = 0; i < Math.min(beforeBlock.assertions.length, afterBlock.assertions.length); i++) {
      const beforeStrength = getAssertionStrength(beforeBlock.assertions[i])
      const afterStrength = getAssertionStrength(afterBlock.assertions[i])

      if (afterStrength < beforeStrength) {
        violations.push({
          file,
          pattern: 'precision-reduction',
          detail: `Test "${name}": .${beforeBlock.assertions[i]}() weakened to .${afterBlock.assertions[i]}()`,
        })
      }
    }
  }

  // Tautology detection across all after blocks
  const strippedAfter = stripComments(after)
  const afterTestRegex = /\b(it|test)(\.skip|\.each\b[^)]*\))?\s*\(\s*(['"`])(.*?)\3/g
  let tMatch: RegExpExecArray | null
  while ((tMatch = afterTestRegex.exec(strippedAfter)) !== null) {
    const name = tMatch[4]
    const startIdx = tMatch.index
    let depth = 0
    let blockStart = -1
    for (let i = startIdx; i < strippedAfter.length; i++) {
      if (strippedAfter[i] === '{' && depth === 0) {
        blockStart = i
        depth = 1
      } else if (strippedAfter[i] === '{') {
        depth++
      } else if (strippedAfter[i] === '}') {
        depth--
        if (depth === 0) {
          const body = strippedAfter.slice(blockStart, i + 1)
          const tautCount = countTautologies(body)
          if (tautCount > 0) {
            violations.push({
              file,
              pattern: 'tautological-assertion',
              detail: `Test "${name}": ${tautCount} tautological assertion(s) (e.g. expect(true).toBe(true))`,
            })
          }
          break
        }
      }
    }
  }

  return violations
}
