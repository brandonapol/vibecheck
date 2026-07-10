import { describe, it, expect } from 'vitest'
import { extractTests, type ExtractedTest } from './test-ast.js'

function byId(tests: ExtractedTest[], id: string): ExtractedTest | undefined {
  return tests.find(t => t.id === id)
}

describe('extractTests — basic test blocks', () => {
  it('extracts a simple it() with one assertion', () => {
    const tests = extractTests(`
      it('adds numbers', () => {
        expect(add(1, 2)).toBe(3)
      })
    `)
    expect(tests).toHaveLength(1)
    expect(tests[0].name).toBe('adds numbers')
    expect(tests[0].id).toBe('adds numbers')
    expect(tests[0].describePath).toEqual([])
    expect(tests[0].skipped).toBe(false)
    expect(tests[0].assertions).toHaveLength(1)
    expect(tests[0].assertions[0].matcher).toBe('toBe')
    expect(tests[0].assertions[0].modifiers).toEqual([])
  })

  it('extracts test() alias', () => {
    const tests = extractTests(`
      test('works', () => {
        expect(x).toEqual(1)
      })
    `)
    expect(tests).toHaveLength(1)
    expect(tests[0].name).toBe('works')
    expect(tests[0].assertions[0].matcher).toBe('toEqual')
  })

  it('preserves assertion order within a test', () => {
    const tests = extractTests(`
      it('shape', () => {
        expect(r.id).toBe(1)
        expect(r.name).toEqual('a')
        expect(r.tags).toHaveLength(2)
      })
    `)
    expect(tests[0].assertions.map(a => a.matcher)).toEqual(['toBe', 'toEqual', 'toHaveLength'])
  })

  it('extracts multiple tests in source order', () => {
    const tests = extractTests(`
      it('first', () => { expect(a).toBe(1) })
      it('second', () => { expect(b).toBe(2) })
    `)
    expect(tests.map(t => t.name)).toEqual(['first', 'second'])
  })

  it('counts assertions inside nested callbacks within the test body', () => {
    const tests = extractTests(`
      it('iterates', () => {
        items.forEach(item => {
          expect(item.id).toBeGreaterThan(0)
        })
      })
    `)
    expect(tests[0].assertions).toHaveLength(1)
    expect(tests[0].assertions[0].matcher).toBe('toBeGreaterThan')
  })

  it('does not count assertions in helper functions outside test blocks', () => {
    const tests = extractTests(`
      function helper() {
        expect(x).toBe(1)
      }
      it('uses helper', () => {
        expect(y).toBe(2)
      })
    `)
    expect(tests).toHaveLength(1)
    expect(tests[0].assertions).toHaveLength(1)
  })
})

describe('extractTests — describe nesting and identity', () => {
  it('records the describe path and builds a path-qualified id', () => {
    const tests = extractTests(`
      describe('auth', () => {
        describe('tokens', () => {
          it('validates token', () => {
            expect(validateToken('abc')).toEqual({ valid: true })
          })
        })
      })
    `)
    expect(tests).toHaveLength(1)
    expect(tests[0].describePath).toEqual(['auth', 'tokens'])
    expect(tests[0].id).toBe('auth > tokens > validates token')
  })

  it('distinguishes same-named tests in different describe blocks', () => {
    const tests = extractTests(`
      describe('auth', () => {
        it('validates', () => { expect(a).toBe(1) })
      })
      describe('payments', () => {
        it('validates', () => { expect(b).toEqual(2) })
      })
    `)
    expect(tests).toHaveLength(2)
    expect(byId(tests, 'auth > validates')).toBeDefined()
    expect(byId(tests, 'payments > validates')).toBeDefined()
  })

  it('marks descendants of describe.skip as skipped', () => {
    const tests = extractTests(`
      describe.skip('legacy', () => {
        it('old behavior', () => { expect(a).toBe(1) })
      })
    `)
    expect(tests[0].skipped).toBe(true)
  })

  it('marks descendants of xdescribe as skipped', () => {
    const tests = extractTests(`
      xdescribe('legacy', () => {
        it('old behavior', () => { expect(a).toBe(1) })
      })
    `)
    expect(tests[0].skipped).toBe(true)
  })

  it('includes describe.each template names in the path', () => {
    const tests = extractTests(`
      describe.each([1, 2])('group %i', (n) => {
        it('works', () => { expect(f(n)).toBe(n) })
      })
    `)
    expect(tests).toHaveLength(1)
    expect(tests[0].describePath).toEqual(['group %i'])
  })
})

describe('extractTests — skip and modifier variants', () => {
  it('marks it.skip as skipped', () => {
    const tests = extractTests(`
      it.skip('later', () => { expect(a).toBe(1) })
    `)
    expect(tests[0].skipped).toBe(true)
  })

  it('marks xit and xtest as skipped', () => {
    const tests = extractTests(`
      xit('one', () => { expect(a).toBe(1) })
      xtest('two', () => { expect(b).toBe(2) })
    `)
    expect(tests.map(t => t.skipped)).toEqual([true, true])
  })

  it('extracts it.only as a normal (non-skipped) test', () => {
    const tests = extractTests(`
      it.only('focus', () => { expect(a).toBe(1) })
    `)
    expect(tests[0].skipped).toBe(false)
    expect(tests[0].assertions).toHaveLength(1)
  })

  it('marks it.todo as a skipped test with no assertions', () => {
    const tests = extractTests(`
      it.todo('someday')
    `)
    expect(tests).toHaveLength(1)
    expect(tests[0].name).toBe('someday')
    expect(tests[0].skipped).toBe(true)
    expect(tests[0].assertions).toHaveLength(0)
  })

  it('treats conditional it.skipIf(...) as skipped (fail closed)', () => {
    const tests = extractTests(`
      it.skipIf(isCI)('flaky', () => { expect(a).toBe(1) })
    `)
    expect(tests[0].skipped).toBe(true)
  })

  it('treats conditional it.runIf(...) as skipped (fail closed)', () => {
    const tests = extractTests(`
      it.runIf(hasNetwork)('online only', () => { expect(a).toBe(1) })
    `)
    expect(tests[0].skipped).toBe(true)
  })

  it('extracts it.fails as a normal test', () => {
    const tests = extractTests(`
      it.fails('known bug', () => { expect(a).toBe(1) })
    `)
    expect(tests[0].skipped).toBe(false)
  })
})

describe('extractTests — parameterized tests', () => {
  it('extracts it.each as a single test with the template name', () => {
    const tests = extractTests(`
      it.each([1, 2, 3])('validates %i', (n) => {
        expect(validate(n)).toBeDefined()
      })
    `)
    expect(tests).toHaveLength(1)
    expect(tests[0].name).toBe('validates %i')
    expect(tests[0].assertions).toHaveLength(1)
    expect(tests[0].assertions[0].matcher).toBe('toBeDefined')
  })

  it('extracts test.each', () => {
    const tests = extractTests(`
      test.each([['a'], ['b']])('handles %s', (s) => {
        expect(handle(s)).toEqual({ ok: true })
      })
    `)
    expect(tests).toHaveLength(1)
    expect(tests[0].name).toBe('handles %s')
  })

  it('extracts it.concurrent and it.concurrent.each chains', () => {
    const tests = extractTests(`
      it.concurrent('parallel', () => { expect(a).toBe(1) })
      it.concurrent.each([1])('parallel %i', (n) => { expect(n).toBe(1) })
    `)
    expect(tests).toHaveLength(2)
    expect(tests[0].name).toBe('parallel')
    expect(tests[1].name).toBe('parallel %i')
    expect(tests.every(t => !t.skipped)).toBe(true)
  })

  it('marks it.skip.each as skipped', () => {
    const tests = extractTests(`
      it.skip.each([1])('later %i', (n) => { expect(n).toBe(1) })
    `)
    expect(tests[0].skipped).toBe(true)
  })
})

describe('extractTests — test names', () => {
  it('handles template literal names without expressions', () => {
    const tests = extractTests(`
      it(\`handles edge case\`, () => { expect(a).toBe(1) })
    `)
    expect(tests[0].name).toBe('handles edge case')
  })

  it('normalizes template literal names with expressions to raw source', () => {
    const tests = extractTests(`
      it(\`handles \${EDGE_CASE} correctly\`, () => { expect(a).toBe(1) })
    `)
    expect(tests[0].name).toBe('handles ${EDGE_CASE} correctly')
    expect(tests[0].assertions).toHaveLength(1)
  })

  it('uses the raw expression text for non-static names', () => {
    const tests = extractTests(`
      it(dynamicName, () => { expect(a).toBe(1) })
    `)
    expect(tests).toHaveLength(1)
    expect(tests[0].name).toBe('dynamicName')
  })
})

describe('extractTests — assertion chains', () => {
  it('records .not as a modifier', () => {
    const tests = extractTests(`
      it('negates', () => { expect(a).not.toBe(1) })
    `)
    expect(tests[0].assertions[0].matcher).toBe('toBe')
    expect(tests[0].assertions[0].modifiers).toEqual(['not'])
  })

  it('records .resolves and .rejects as modifiers', () => {
    const tests = extractTests(`
      it('async', async () => {
        await expect(p).resolves.toEqual({ ok: true })
        await expect(q).rejects.toThrowError('boom')
      })
    `)
    expect(tests[0].assertions[0].modifiers).toEqual(['resolves'])
    expect(tests[0].assertions[0].matcher).toBe('toEqual')
    expect(tests[0].assertions[1].modifiers).toEqual(['rejects'])
    expect(tests[0].assertions[1].matcher).toBe('toThrowError')
  })

  it('records expect.soft as a soft modifier', () => {
    const tests = extractTests(`
      it('soft', () => { expect.soft(a).toBe(1) })
    `)
    expect(tests[0].assertions).toHaveLength(1)
    expect(tests[0].assertions[0].matcher).toBe('toBe')
    expect(tests[0].assertions[0].modifiers).toContain('soft')
  })

  it('does not count expect.assertions() or expect.hasAssertions() as assertions', () => {
    const tests = extractTests(`
      it('meta', () => {
        expect.assertions(2)
        expect.hasAssertions()
        expect(a).toBe(1)
      })
    `)
    expect(tests[0].assertions).toHaveLength(1)
  })

  it('extracts custom matcher names', () => {
    const tests = extractTests(`
      it('custom', () => { expect(a).toBeWithinRange(1, 10) })
    `)
    expect(tests[0].assertions[0].matcher).toBe('toBeWithinRange')
  })
})

describe('extractTests — tautology detection', () => {
  it('marks expect(true).toBe(true) as tautological', () => {
    const tests = extractTests(`
      it('taut', () => { expect(true).toBe(true) })
    `)
    expect(tests[0].assertions[0].tautological).toBe(true)
  })

  it('marks literal-to-literal toEqual and toStrictEqual as tautological', () => {
    const tests = extractTests(`
      it('taut', () => {
        expect(1).toEqual(1)
        expect('a').toStrictEqual('a')
      })
    `)
    expect(tests[0].assertions.every(a => a.tautological)).toBe(true)
  })

  it('does not mark real assertions as tautological', () => {
    const tests = extractTests(`
      it('real', () => {
        expect(calculate(10)).toBe(100)
        expect(x).toBe(true)
      })
    `)
    expect(tests[0].assertions.some(a => a.tautological)).toBe(false)
  })
})

describe('extractTests — fail-closed on dynamic constructs', () => {
  it('flags computed matcher access as suspicious', () => {
    const tests = extractTests(`
      it('dodgy', () => {
        const method = 'toBeDefined'
        expect(result)[method]()
      })
    `)
    expect(tests[0].suspicious.length).toBeGreaterThan(0)
    expect(tests[0].assertions).toHaveLength(0)
  })

  it('does not flag ordinary static assertions as suspicious', () => {
    const tests = extractTests(`
      it('fine', () => { expect(a).toBe(1) })
    `)
    expect(tests[0].suspicious).toHaveLength(0)
  })
})

describe('extractTests — comments and syntax', () => {
  it('ignores assertions in line comments', () => {
    const tests = extractTests(`
      it('commented', () => {
        // expect(a).toBe(1)
        expect(b).toBe(2)
      })
    `)
    expect(tests[0].assertions).toHaveLength(1)
  })

  it('ignores assertions in block comments', () => {
    const tests = extractTests(`
      it('commented', () => {
        /* expect(a).toBe(1) */
        expect(b).toBe(2)
      })
    `)
    expect(tests[0].assertions).toHaveLength(1)
  })

  it('parses TypeScript syntax', () => {
    const tests = extractTests(`
      interface Foo { id: number }
      it('typed', () => {
        const f: Foo = make<Foo>()
        expect(f.id).toBe(1)
      })
    `)
    expect(tests).toHaveLength(1)
    expect(tests[0].assertions).toHaveLength(1)
  })

  it('parses JSX in test bodies', () => {
    const tests = extractTests(`
      it('renders', () => {
        const el = render(<Button label="hi" />)
        expect(el.text()).toBe('hi')
      })
    `)
    expect(tests).toHaveLength(1)
  })

  it('returns an empty list for source with no tests', () => {
    expect(extractTests('const a = 1')).toEqual([])
    expect(extractTests('')).toEqual([])
  })
})
