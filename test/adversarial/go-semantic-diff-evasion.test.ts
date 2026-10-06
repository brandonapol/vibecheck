import { describe, it, expect } from 'vitest'
import { execaSync } from 'execa'
import { detectWeakeningWithAdapter, type WeakeningPattern } from '../../src/analyzers/semantic-diff.js'
import { goAdapter } from '../../src/languages/go.js'

/**
 * ADVERSARIAL TESTS: ways an agent weakens a Go test without deleting the file.
 * Each case is a base version and a weakened version of the same `_test.go`;
 * every one must be reported.
 */

const hasGo = (() => {
  try {
    execaSync('go', ['version'])
    return true
  } catch {
    return false
  }
})()

const file = 'pkg/sum/sum_test.go'

function goFile(body: string): string {
  return `package sum\n\nimport "testing"\n\n${body}\n`
}

async function patterns(before: string, after: string): Promise<WeakeningPattern[]> {
  const violations = await detectWeakeningWithAdapter(goFile(before), goFile(after), file, goAdapter)
  return violations.map(v => v.pattern)
}

const TABLE = (rows: string) => `func TestDouble(t *testing.T) {
	tests := []struct {
		name string
		in   int
		want int
	}{
${rows}
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := Double(tc.in); got != tc.want {
				t.Fatalf("Double(%d) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
}`

describe.skipIf(!hasGo)('Go semantic diff evasion attacks (requires go)', () => {
  it('catches a table row being deleted', async () => {
    const before = TABLE(`\t\t{"one", 1, 2},\n\t\t{"negative", -1, -2},`)
    const after = TABLE(`\t\t{"one", 1, 2},`)
    expect(await patterns(before, after)).toContain('test-deletion')
  })

  it("catches a row's expected value being changed", async () => {
    const before = TABLE(`\t\t{"one", 1, 2},`)
    const after = TABLE(`\t\t{"one", 1, 3},`)
    expect(await patterns(before, after)).toContain('test-body-changed')
  })

  it('catches t.Skip being added', async () => {
    const before = `func TestSum(t *testing.T) {\n\tif Sum(1, 2) != 3 {\n\t\tt.Fatal("x")\n\t}\n}`
    const after = `func TestSum(t *testing.T) {\n\tt.Skip("flaky")\n\tif Sum(1, 2) != 3 {\n\t\tt.Fatal("x")\n\t}\n}`
    expect(await patterns(before, after)).toContain('skip-addition')
  })

  it('catches a testing.Short guard being added', async () => {
    const before = `func TestSum(t *testing.T) {\n\tif Sum(1, 2) != 3 {\n\t\tt.Fatal("x")\n\t}\n}`
    const after = `func TestSum(t *testing.T) {\n\tif testing.Short() {\n\t\tt.Skip()\n\t}\n\tif Sum(1, 2) != 3 {\n\t\tt.Fatal("x")\n\t}\n}`
    expect(await patterns(before, after)).toContain('skip-addition')
  })

  it('catches a failure branch being removed', async () => {
    const before = `func TestParse(t *testing.T) {\n\tv, err := Parse("1")\n\tif err != nil {\n\t\tt.Fatal(err)\n\t}\n\tif v != 1 {\n\t\tt.Fatalf("got %d", v)\n\t}\n}`
    const after = `func TestParse(t *testing.T) {\n\tv, err := Parse("1")\n\tif err != nil {\n\t\tt.Fatal(err)\n\t}\n\t_ = v\n}`
    expect(await patterns(before, after)).toContain('assertion-count-reduction')
  })

  it('catches DeepEqual being replaced by a nil check', async () => {
    const before = `func TestList(t *testing.T) {\n\tgot := List()\n\tif !reflect.DeepEqual(got, []int{1, 2}) {\n\t\tt.Fatal("x")\n\t}\n}`
    const after = `func TestList(t *testing.T) {\n\tgot := List()\n\tif got == nil {\n\t\tt.Fatal("x")\n\t}\n}`
    expect(await patterns(before, after)).toContain('precision-reduction')
  })

  it('catches cmp.Diff being replaced by a length check', async () => {
    const before = `func TestList(t *testing.T) {\n\tgot := List()\n\tif diff := cmp.Diff([]int{1, 2}, got); diff != "" {\n\t\tt.Fatal(diff)\n\t}\n}`
    const after = `func TestList(t *testing.T) {\n\tgot := List()\n\tif len(got) != 2 {\n\t\tt.Fatal("x")\n\t}\n}`
    expect(await patterns(before, after)).toContain('precision-reduction')
  })

  it('catches errors.Is being relaxed to any error', async () => {
    const before = `func TestFind(t *testing.T) {\n\t_, err := Find("x")\n\tif !errors.Is(err, ErrNotFound) {\n\t\tt.Fatal(err)\n\t}\n}`
    const after = `func TestFind(t *testing.T) {\n\t_, err := Find("x")\n\tif err == nil {\n\t\tt.Fatal("expected an error")\n\t}\n}`
    expect(await patterns(before, after)).toContain('precision-reduction')
  })

  it('catches the expected value in a comparison being changed', async () => {
    const before = `func TestSum(t *testing.T) {\n\tif got := Sum(1, 2); got != 3 {\n\t\tt.Fatal("x")\n\t}\n}`
    const after = `func TestSum(t *testing.T) {\n\tif got := Sum(1, 2); got != 4 {\n\t\tt.Fatal("x")\n\t}\n}`
    expect(await patterns(before, after)).toContain('assertion-changed')
  })

  it('catches an assertion moved behind a branch that may not run', async () => {
    const before = `func TestSum(t *testing.T) {\n\tif got := Sum(1, 2); got != 3 {\n\t\tt.Fatal("x")\n\t}\n}`
    const after = `func TestSum(t *testing.T) {\n\tif os.Getenv("CI") != "" {\n\t\tif got := Sum(1, 2); got != 3 {\n\t\t\tt.Fatal("x")\n\t\t}\n\t}\n}`
    expect(await patterns(before, after)).toContain('assertion-neutralized')
  })

  it('catches a self-comparison', async () => {
    const before = `func TestSum(t *testing.T) {\n\tgot := Sum(1, 2)\n\tif got != 3 {\n\t\tt.Fatal("x")\n\t}\n}`
    const after = `func TestSum(t *testing.T) {\n\tgot := Sum(1, 2)\n\tif got != got {\n\t\tt.Fatal("x")\n\t}\n}`
    expect(await patterns(before, after)).toContain('tautological-assertion')
  })

  it('catches testify Equal being weakened to NotNil', async () => {
    const before = `func TestSum(t *testing.T) {\n\tassert.Equal(t, 3, Sum(1, 2))\n}`
    const after = `func TestSum(t *testing.T) {\n\tassert.NotNil(t, Sum(1, 2))\n}`
    expect(await patterns(before, after)).toContain('precision-reduction')
  })

  it('catches a new test that only checks for a nil error', async () => {
    const before = ''
    const after = `func TestParse(t *testing.T) {\n\tif _, err := Parse("1"); err == nil {\n\t\tt.Fatal("x")\n\t}\n}`
    expect(await patterns(before, after)).toContain('weak-new-test')
  })

  it('reports nothing when the file is only reformatted', async () => {
    const before = `func TestSum(t *testing.T) {\n\tif got := Sum(1, 2); got != 3 { t.Fatalf("got %d", got) }\n}`
    const after = `func TestSum(t *testing.T) {\n\tif got := Sum(\n\t\t1,\n\t\t2,\n\t); got != 3 {\n\t\tt.Fatalf("got %d", got)\n\t}\n}`
    expect(await patterns(before, after)).toEqual([])
  })

  it('reports nothing when a failure message is reworded', async () => {
    const before = `func TestSum(t *testing.T) {\n\tif got := Sum(1, 2); got != 3 {\n\t\tt.Fatalf("got %d", got)\n\t}\n}`
    const after = `func TestSum(t *testing.T) {\n\tif got := Sum(1, 2); got != 3 {\n\t\tt.Fatalf("Sum(1, 2) = %d, want 3", got)\n\t}\n}`
    expect(await patterns(before, after)).toEqual([])
  })

  it('reports nothing when a table row is added', async () => {
    const before = TABLE(`\t\t{"one", 1, 2},`)
    const after = TABLE(`\t\t{"one", 1, 2},\n\t\t{"two", 2, 4},`)
    expect(await patterns(before, after)).toEqual([])
  })
})
