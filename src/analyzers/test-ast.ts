import { parse } from '@babel/parser'

export type ExtractedAssertion = {
  matcher: string
  modifiers: string[]
  tautological: boolean
  hasArguments: boolean
  /** Structural fingerprint of the whole chain; equal across formatting changes. */
  key: string
  source: string
}

export type ExtractedTest = {
  name: string
  describePath: string[]
  id: string
  skipped: boolean
  assertions: ExtractedAssertion[]
  suspicious: string[]
  /** Fingerprint of the body and any `.each` table, with assertions removed. */
  bodyKey: string
}

/** A non-test statement at file or describe level (consts, helpers, hooks). */
export type SetupStatement = {
  key: string
  source: string
}

type Node = {
  type: string
  [key: string]: unknown
}

const TEST_BASES = new Set(['it', 'test', 'xit', 'xtest'])
const DESCRIBE_BASES = new Set(['describe', 'xdescribe'])
// Chain members that mean the test may not run: fail closed and treat as skipped.
const SKIP_MODIFIERS = new Set(['skip', 'todo', 'skipIf', 'runIf'])
const CHAIN_MODIFIERS = new Set([
  'skip', 'only', 'todo', 'fails', 'concurrent', 'sequential', 'each', 'skipIf', 'runIf',
])
const EXPECT_MODIFIERS = new Set(['not', 'resolves', 'rejects', 'soft'])
const TAUTOLOGY_MATCHERS = new Set(['toBe', 'toEqual', 'toStrictEqual'])

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string'
}

function childNodes(node: Node): Node[] {
  const children: Node[] = []
  for (const key of Object.keys(node)) {
    if (key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue
    const value = node[key]
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) children.push(item)
      }
    } else if (isNode(value)) {
      children.push(value)
    }
  }
  return children
}

const NON_STRUCTURAL_KEYS = new Set([
  'start', 'end', 'loc', 'range', 'extra',
  'leadingComments', 'trailingComments', 'innerComments', 'comments',
])

/** Returns a substitute fingerprint for a node, null to drop it, or undefined
 *  to fingerprint it normally. */
type Replacer = (node: Node) => string | null | undefined

/** `{ total: 1 }` and `{ "total": 1 }` are the same object: print a
 *  non-computed identifier key as a string literal. */
function normalizePropertyKey(node: Node, key: string): unknown {
  const value = node[key]
  const isPropertyKey =
    key === 'key' &&
    !node.computed &&
    (node.type === 'ObjectProperty' || node.type === 'ObjectMethod') &&
    isNode(value) &&
    value.type === 'Identifier'
  return isPropertyKey ? { type: 'StringLiteral', value: (value as Node).name } : value
}

/** Serialize AST shape, ignoring locations, comments, and raw text (quote
 *  style, numeric spelling), so reformatting yields the same fingerprint. */
function fingerprint(value: unknown, replace?: Replacer): string {
  if (Array.isArray(value)) {
    const items: string[] = []
    for (const item of value) {
      const printed = isNode(item) && replace ? replace(item) : undefined
      if (printed === null) continue
      items.push(printed ?? fingerprint(item, replace))
    }
    return '[' + items.join(',') + ']'
  }
  if (isNode(value)) {
    const replaced = replace?.(value)
    if (replaced === null) return 'null'
    if (replaced !== undefined) return replaced
    const fields: string[] = []
    for (const key of Object.keys(value).sort()) {
      if (NON_STRUCTURAL_KEYS.has(key)) continue
      fields.push(key + ':' + fingerprint(normalizePropertyKey(value, key), replace))
    }
    return '{' + fields.join(',') + '}'
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return '{' + Object.keys(record).sort().map(k => k + ':' + fingerprint(record[k], replace)).join(',') + '}'
  }
  return JSON.stringify(value) ?? 'undefined'
}

function sliceSource(source: string, node: Node): string {
  const start = node.start as number | null
  const end = node.end as number | null
  if (typeof start !== 'number' || typeof end !== 'number') return ''
  return source.slice(start, end)
}

/** Static name for a test/describe: string literal value, template literal
 *  normalized to its raw source (`${expr}` kept verbatim), else raw source text. */
function resolveName(node: Node, source: string): string {
  if (node.type === 'StringLiteral') return node.value as string
  if (node.type === 'TemplateLiteral') {
    const quasis = node.quasis as Node[]
    const expressions = node.expressions as Node[]
    let name = ''
    for (let i = 0; i < quasis.length; i++) {
      name += (quasis[i].value as { raw: string }).raw
      if (i < expressions.length) {
        name += '${' + sliceSource(source, expressions[i]) + '}'
      }
    }
    return name
  }
  return sliceSource(source, node)
}

type CalleeInfo = {
  base: string
  modifiers: string[]
}

/** Resolve a call's callee to a base identifier plus dotted/called chain members.
 *  Handles `it`, `it.skip`, `it.each(tbl)(...)`, `it.concurrent.each(tbl)(...)`,
 *  `it.skipIf(cond)(...)`. Returns null for anything else (incl. computed access). */
function resolveCallee(callee: Node): CalleeInfo | null {
  const modifiers: string[] = []
  let current: Node = callee

  for (;;) {
    if (current.type === 'CallExpression') {
      // e.g. the `it.each(tbl)` in `it.each(tbl)('name', fn)`
      current = current.callee as Node
      continue
    }
    if (current.type === 'MemberExpression') {
      if (current.computed) return null
      const property = current.property as Node
      if (property.type !== 'Identifier') return null
      modifiers.unshift(property.name as string)
      current = current.object as Node
      continue
    }
    if (current.type === 'Identifier') {
      return { base: current.name as string, modifiers }
    }
    return null
  }
}

/** Arguments of calls inside a registration callee, e.g. the table in
 *  `it.each(table)` or the condition in `it.skipIf(cond)`. */
function calleeCallArgs(callee: Node): Node[] {
  const args: Node[] = []
  let current: Node = callee
  while (current.type === 'CallExpression' || current.type === 'MemberExpression') {
    if (current.type === 'CallExpression') {
      args.unshift(...(current.arguments as Node[]))
      current = current.callee as Node
    } else {
      current = current.object as Node
    }
  }
  return args
}

type Registration = {
  kind: 'test' | 'describe'
  skipped: boolean
}

function classifyRegistration(callee: Node): Registration | null {
  const info = resolveCallee(callee)
  if (!info) return null

  const isTest = TEST_BASES.has(info.base)
  const isDescribe = DESCRIBE_BASES.has(info.base)
  if (!isTest && !isDescribe) return null
  if (!info.modifiers.every(m => CHAIN_MODIFIERS.has(m))) return null

  const skipped = info.base.startsWith('x') || info.modifiers.some(m => SKIP_MODIFIERS.has(m))
  return { kind: isTest ? 'test' : 'describe', skipped }
}

function isLiteralValue(node: Node): boolean {
  switch (node.type) {
    case 'BooleanLiteral':
    case 'NumericLiteral':
    case 'StringLiteral':
    case 'NullLiteral':
      return true
    case 'Identifier':
      return node.name === 'undefined' || node.name === 'NaN'
    case 'UnaryExpression':
      return node.operator === '-' && isLiteralValue(node.argument as Node)
    default:
      return false
  }
}

/** Root of an assertion chain: `expect(...)` or `expect.soft(...)`.
 *  Returns the expect call's arguments plus any root modifier, or null. */
function resolveExpectRoot(node: Node): { args: Node[]; modifiers: string[] } | null {
  if (node.type !== 'CallExpression') return null
  const callee = node.callee as Node
  if (callee.type === 'Identifier' && callee.name === 'expect') {
    return { args: node.arguments as Node[], modifiers: [] }
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    (callee.object as Node).type === 'Identifier' &&
    ((callee.object as Node).name as string) === 'expect' &&
    (callee.property as Node).type === 'Identifier' &&
    ((callee.property as Node).name as string) === 'soft'
  ) {
    return { args: node.arguments as Node[], modifiers: ['soft'] }
  }
  return null
}

function containsExpectCall(node: Node): boolean {
  if (resolveExpectRoot(node)) return true
  return childNodes(node).some(containsExpectCall)
}

type BodyScan = {
  assertions: ExtractedAssertion[]
  suspicious: string[]
}

/** Walk a test body collecting assertion chains rooted at expect()/expect.soft().
 *  Computed member access over an expect chain is recorded as suspicious. */
function scanBody(node: Node, source: string, out: BodyScan): void {
  if (node.type === 'CallExpression') {
    const callee = node.callee as Node

    if (callee.type === 'MemberExpression') {
      if (callee.computed) {
        if (containsExpectCall(callee.object as Node)) {
          out.suspicious.push(
            `dynamic assertion call: ${sliceSource(source, node)}`,
          )
          // Still scan the expect() receiver's arguments, then stop.
          scanBody(callee.object as Node, source, out)
          for (const arg of node.arguments as Node[]) scanBody(arg, source, out)
          return
        }
      } else {
        const chain = collectExpectChain(node, source)
        if (chain) {
          out.assertions.push(chain.assertion)
          // Scan the expect() argument and the matcher arguments for nested chains.
          for (const arg of chain.innerArgs) scanBody(arg, source, out)
          for (const arg of node.arguments as Node[]) scanBody(arg, source, out)
          return
        }
      }
    }
  }

  for (const child of childNodes(node)) scanBody(child, source, out)
}

type ChainResult = {
  assertion: ExtractedAssertion
  innerArgs: Node[]
}

/** If `call` is the outermost call of an expect chain
 *  (`expect(x).not.toBe(1)`, `expect.soft(x).toEqual(y)`, ...), extract it. */
function collectExpectChain(call: Node, source: string): ChainResult | null {
  const callee = call.callee as Node
  if (callee.type !== 'MemberExpression' || callee.computed) return null

  const property = callee.property as Node
  if (property.type !== 'Identifier') return null
  const matcher = property.name as string

  const modifiers: string[] = []
  let current = callee.object as Node
  while (
    current.type === 'MemberExpression' &&
    !(current as Node).computed &&
    ((current.property as Node).type as string) === 'Identifier' &&
    EXPECT_MODIFIERS.has((current.property as Node).name as string)
  ) {
    modifiers.unshift((current.property as Node).name as string)
    current = current.object as Node
  }

  const root = resolveExpectRoot(current)
  if (!root) return null

  const allModifiers = [...root.modifiers, ...modifiers]
  const expectArg = root.args[0]
  const matcherArg = (call.arguments as Node[])[0]
  const tautological =
    TAUTOLOGY_MATCHERS.has(matcher) &&
    allModifiers.length === 0 &&
    expectArg !== undefined &&
    isLiteralValue(expectArg) &&
    matcherArg !== undefined &&
    isLiteralValue(matcherArg)

  return {
    assertion: {
      matcher,
      modifiers: allModifiers,
      tautological,
      hasArguments: (call.arguments as Node[]).length > 0,
      key: fingerprint(call),
      source: sliceSource(source, call),
    },
    innerArgs: root.args,
  }
}

function isAssertionCall(node: Node): boolean {
  if (node.type !== 'CallExpression') return false
  const callee = node.callee as Node
  if (callee.type !== 'MemberExpression') return false
  if (callee.computed) return containsExpectCall(callee.object as Node)
  return collectExpectChain(node, '') !== null
}

/** Drops assertion statements and masks inline assertions, so the body
 *  fingerprint only reflects setup, inputs, and control flow. */
const stripAssertions: Replacer = node => {
  if (node.type === 'ExpressionStatement') {
    let expression = node.expression as Node
    if (expression.type === 'AwaitExpression') expression = expression.argument as Node
    if (isAssertionCall(expression)) return null
  }
  if (isAssertionCall(node)) return '<assertion>'
  return undefined
}

function walk(
  node: Node,
  source: string,
  describePath: string[],
  ancestorSkipped: boolean,
  tests: ExtractedTest[],
): void {
  if (node.type === 'CallExpression') {
    const registration = classifyRegistration(node.callee as Node)
    if (registration) {
      const args = node.arguments as Node[]
      const nameNode = args[0]
      if (nameNode) {
        const name = resolveName(nameNode, source)
        const skipped = ancestorSkipped || registration.skipped
        const body = args[1]

        if (registration.kind === 'describe') {
          if (body) walk(body, source, [...describePath, name], skipped, tests)
          return
        }

        const scan: BodyScan = { assertions: [], suspicious: [] }
        if (body) scanBody(body, source, scan)
        const table = calleeCallArgs(node.callee as Node)
        tests.push({
          name,
          describePath: [...describePath],
          id: [...describePath, name].join(' > '),
          skipped,
          assertions: scan.assertions,
          suspicious: scan.suspicious,
          bodyKey: fingerprint([table, args.slice(1)], stripAssertions),
        })
        return
      }
    }
  }

  for (const child of childNodes(node)) {
    walk(child, source, describePath, ancestorSkipped, tests)
  }
}

function parseProgram(source: string): Node {
  const ast = parse(source, {
    sourceType: 'unambiguous',
    errorRecovery: true,
    plugins: ['typescript', 'jsx'],
  })
  return ast.program as unknown as Node
}

export function extractTests(source: string): ExtractedTest[] {
  if (source.trim() === '') return []

  const tests: ExtractedTest[] = []
  walk(parseProgram(source), source, [], false, tests)
  return tests
}

/** Tests nested inside setup code (e.g. a loop) are compared on their own. */
const maskRegistrations: Replacer = node => {
  if (node.type === 'CallExpression' && classifyRegistration(node.callee as Node)) return '<registration>'
  return undefined
}

function collectSetup(statements: Node[], source: string, out: SetupStatement[]): void {
  for (const statement of statements) {
    if (statement.type === 'ImportDeclaration') continue

    const expression = statement.type === 'ExpressionStatement' ? (statement.expression as Node) : null
    const registration =
      expression?.type === 'CallExpression' ? classifyRegistration(expression.callee as Node) : null

    if (expression && registration) {
      const table = calleeCallArgs(expression.callee as Node)
      if (table.length > 0) {
        out.push({ key: fingerprint(table), source: sliceSource(source, expression.callee as Node) })
      }
      const body = (expression.arguments as Node[])[1]
      if (registration.kind === 'describe' && body && (body.body as Node | undefined)?.type === 'BlockStatement') {
        collectSetup((body.body as Node).body as Node[], source, out)
      }
      continue
    }

    out.push({ key: fingerprint(statement, maskRegistrations), source: sliceSource(source, statement) })
  }
}

export function extractSetup(source: string): SetupStatement[] {
  if (source.trim() === '') return []

  const setup: SetupStatement[] = []
  collectSetup(parseProgram(source).body as Node[], source, setup)
  return setup
}
