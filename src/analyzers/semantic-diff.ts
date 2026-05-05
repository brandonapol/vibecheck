export type WeakeningPattern =
  | 'precision-reduction'
  | 'error-relaxation'
  | 'bound-loosening'
  | 'test-deletion'
  | 'skip-addition'
  | 'assertion-count-reduction'

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
  toBeTruthy: 3,
  toBeFalsy: 3,
  toBeDefined: 2,
  toBeUndefined: 2,
  toBeNull: 3,
  toThrow: 4,
  toThrowError: 7,
}

type TestBlock = {
  name: string
  assertions: string[]
  skipped: boolean
}

function extractTestBlocks(source: string): TestBlock[] {
  const blocks: TestBlock[] = []
  const testRegex = /\b(it|test)(\.skip)?\s*\(\s*(['"`])(.*?)\3/g
  let match: RegExpExecArray | null

  while ((match = testRegex.exec(source)) !== null) {
    const skipped = match[2] === '.skip'
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
          const body = source.slice(blockStart, i + 1)
          const assertions = extractAssertionMethods(body)
          blocks.push({ name, assertions, skipped })
          break
        }
      }
    }
  }

  return blocks
}

function extractAssertionMethods(body: string): string[] {
  const assertionRegex = /\.(toBe|toEqual|toStrictEqual|toMatchObject|toHaveLength|toContain|toBeTruthy|toBeFalsy|toBeDefined|toBeUndefined|toBeNull|toThrow|toThrowError)\b/g
  const methods: string[] = []
  let match: RegExpExecArray | null
  while ((match = assertionRegex.exec(body)) !== null) {
    methods.push(match[1])
  }
  return methods
}

function getAssertionStrength(method: string): number {
  return ASSERTION_STRENGTH[method] ?? 0
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

  return violations
}
