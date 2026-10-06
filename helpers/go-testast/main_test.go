package main

import (
	"strings"
	"testing"
)

func mustExtract(t *testing.T, src string) Result {
	t.Helper()
	result, err := Extract([]byte(src))
	if err != nil {
		t.Fatalf("Extract: %v", err)
	}
	return result
}

func findTest(t *testing.T, result Result, id string) Test {
	t.Helper()
	for _, test := range result.Tests {
		if test.ID == id {
			return test
		}
	}
	ids := make([]string, 0, len(result.Tests))
	for _, test := range result.Tests {
		ids = append(ids, test.ID)
	}
	t.Fatalf("no test %q; have %v", id, ids)
	return Test{}
}

func matchers(test Test) []string {
	out := make([]string, 0, len(test.Assertions))
	for _, a := range test.Assertions {
		out = append(out, a.Matcher)
	}
	return out
}

func TestExtractRejectsInvalidSource(t *testing.T) {
	if _, err := Extract([]byte("package x\nfunc {")); err == nil {
		t.Fatal("expected a parse error")
	}
}

func TestTopLevelTestsAndSubtests(t *testing.T) {
	result := mustExtract(t, `package x
import "testing"
func TestSum(t *testing.T) {
	t.Run("adds", func(t *testing.T) {
		if got := Sum(1, 2); got != 3 {
			t.Errorf("got %d", got)
		}
	})
}
func helper() {}
func TestOther(t *testing.T) {}
`)
	var ids []string
	for _, test := range result.Tests {
		ids = append(ids, test.ID)
	}
	if strings.Join(ids, ",") != "TestSum,TestSum/adds,TestOther" {
		t.Fatalf("ids = %v", ids)
	}
	sub := findTest(t, result, "TestSum/adds")
	if sub.Name != "adds" || strings.Join(sub.DescribePath, "/") != "TestSum" {
		t.Fatalf("subtest identity = %q %v", sub.Name, sub.DescribePath)
	}
	if got := matchers(sub); len(got) != 1 || got[0] != "equal" {
		t.Fatalf("matchers = %v", got)
	}
	if len(findTest(t, result, "TestSum").Assertions) != 0 {
		t.Fatal("subtest assertions leaked into the parent")
	}
}

func TestClassifiesIfGuardedFailures(t *testing.T) {
	result := mustExtract(t, `package x
import "testing"
func TestKinds(t *testing.T) {
	if got != want { t.Errorf("x") }
	if !reflect.DeepEqual(got, want) { t.Fatal("x") }
	if diff := cmp.Diff(want, got); diff != "" { t.Error(diff) }
	if len(items) != 3 { t.Fatal("x") }
	if n > 10 { t.Fatal("x") }
	if !errors.Is(err, ErrNotFound) { t.Fatal("x") }
	if !strings.Contains(out, "ok") { t.Fatal("x") }
	if err != nil { t.Fatal(err) }
	if err == nil { t.Fatal("expected an error") }
	if v == nil { t.Fatal("x") }
	if v != nil { t.Fatal("x") }
	if !ok { t.Fatal("x") }
	if isValid(v) { t.Fatal("x") }
}
`)
	want := "equal,deepEqual,deepEqual,length,bound,errorIs,contains,noError,anyError,notNil,isNil,truthy,predicate"
	if got := strings.Join(matchers(findTest(t, result, "TestKinds")), ","); got != want {
		t.Fatalf("matchers =\n %s\nwant\n %s", got, want)
	}
}

func TestElseBranchFailureUsesTheCondition(t *testing.T) {
	result := mustExtract(t, `package x
import "testing"
func TestElse(t *testing.T) {
	if got == want {
	} else {
		t.Fatal("x")
	}
	if err == nil {
	} else {
		t.Fatal(err)
	}
}
`)
	if got := strings.Join(matchers(findTest(t, result, "TestElse")), ","); got != "equal,noError" {
		t.Fatalf("matchers = %s", got)
	}
}

func TestTautologies(t *testing.T) {
	result := mustExtract(t, `package x
import "testing"
func TestTaut(t *testing.T) {
	if got != got { t.Fatal("x") }
	if 1 != 1 { t.Fatal("x") }
	if false { t.Fatal("x") }
	assert.Equal(t, v, v)
	assert.True(t, true)
	if got != want { t.Fatal("x") }
}
`)
	var flags []bool
	for _, a := range findTest(t, result, "TestTaut").Assertions {
		flags = append(flags, a.Tautological)
	}
	if len(flags) != 6 || !flags[0] || !flags[1] || !flags[2] || !flags[3] || !flags[4] || flags[5] {
		t.Fatalf("tautological flags = %v", flags)
	}
}

func TestTestifyCalls(t *testing.T) {
	result := mustExtract(t, `package x
import "testing"
func TestTestify(t *testing.T) {
	assert.Equal(t, 3, Sum(1, 2))
	require.NoError(t, err)
	assert.NotNilf(t, v, "msg")
	assert.ErrorIs(t, err, ErrX)
}
`)
	test := findTest(t, result, "TestTestify")
	if got := strings.Join(matchers(test), ","); got != "Equal,NoError,NotNil,ErrorIs" {
		t.Fatalf("matchers = %s", got)
	}
	if !test.Assertions[0].HasArguments || test.Assertions[2].HasArguments {
		t.Fatalf("hasArguments = %v / %v", test.Assertions[0].HasArguments, test.Assertions[2].HasArguments)
	}
}

func TestHelperCallsTakingTCountAsAssertions(t *testing.T) {
	result := mustExtract(t, `package x
import "testing"
func TestHelper(t *testing.T) {
	t.Parallel()
	checkSum(t, 1, 2, 3)
}
`)
	if got := strings.Join(matchers(findTest(t, result, "TestHelper")), ","); got != "checkSum" {
		t.Fatalf("matchers = %s", got)
	}
}

func TestSkips(t *testing.T) {
	result := mustExtract(t, `package x
import "testing"
func TestSkipped(t *testing.T) {
	t.Skip("later")
	t.Run("child", func(t *testing.T) {})
}
func TestShort(t *testing.T) {
	if testing.Short() { t.Skip() }
}
func TestRuns(t *testing.T) {
	t.Run("skips", func(t *testing.T) { t.SkipNow() })
	t.Run("runs", func(t *testing.T) {})
}
`)
	for id, want := range map[string]bool{
		"TestSkipped": true, "TestSkipped/child": true, "TestShort": true,
		"TestRuns": false, "TestRuns/skips": true, "TestRuns/runs": false,
	} {
		if got := findTest(t, result, id).Skipped; got != want {
			t.Errorf("%s skipped = %v, want %v", id, got, want)
		}
	}
}

func TestNamedTableRowsBecomeTests(t *testing.T) {
	result := mustExtract(t, `package x
import "testing"
func TestTable(t *testing.T) {
	tests := []struct {
		name string
		in   int
		want int
	}{
		{name: "one", in: 1, want: 2},
		{"two", 2, 4},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := Double(tc.in); got != tc.want {
				t.Fatalf("got %d", got)
			}
		})
	}
}
`)
	one := findTest(t, result, "TestTable/one")
	two := findTest(t, result, "TestTable/two")
	if len(one.Assertions) != 1 || one.Assertions[0].Conditional {
		t.Fatalf("row assertions = %+v", one.Assertions)
	}
	if one.BodyKey == two.BodyKey {
		t.Fatal("rows with different values share a body key")
	}
}

func TestMapTableRowsUseTheirKeys(t *testing.T) {
	result := mustExtract(t, `package x
import "testing"
var cases = map[string]struct{ in, want int }{
	"one": {1, 2},
	"two": {2, 4},
}
func TestMap(t *testing.T) {
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if Double(tc.in) != tc.want { t.Fatal("x") }
		})
	}
}
`)
	findTest(t, result, "TestMap/one")
	findTest(t, result, "TestMap/two")
	for _, s := range result.Setup {
		if strings.Contains(s.Source, "cases") {
			t.Fatalf("an expanded table is compared per row, not as setup: %q", s.Source)
		}
	}
}

func TestUnresolvableLoopsAreConditional(t *testing.T) {
	result := mustExtract(t, `package x
import "testing"
func TestLoop(t *testing.T) {
	for _, v := range load() {
		if v < 0 { t.Fatal("x") }
	}
	for _, v := range []int{1, 2} {
		if v < 0 { t.Fatal("x") }
	}
	if flaky {
		if got != want { t.Fatal("x") }
	}
}
`)
	var flags []bool
	for _, a := range findTest(t, result, "TestLoop").Assertions {
		flags = append(flags, a.Conditional)
	}
	if len(flags) != 3 || !flags[0] || flags[1] || !flags[2] {
		t.Fatalf("conditional flags = %v", flags)
	}
}

func TestKeysIgnoreFormattingCommentsAndMessages(t *testing.T) {
	a := mustExtract(t, `package x
import "testing"
func TestF(t *testing.T) {
	got := Sum(1, 2) // compute
	if got != 3 { t.Errorf("bad: %d", got) }
}
`)
	b := mustExtract(t, `package x

import "testing"

func TestF(t *testing.T) {
	got := Sum(
		1,
		2,
	)
	if got != 3 {
		t.Errorf("sum was wrong: %d", got)
	}
}
`)
	ta, tb := findTest(t, a, "TestF"), findTest(t, b, "TestF")
	if ta.BodyKey != tb.BodyKey {
		t.Fatal("formatting changed the body key")
	}
	if ta.Assertions[0].Key != tb.Assertions[0].Key {
		t.Fatal("formatting or the failure message changed the assertion key")
	}
}

func TestBodyKeyExcludesAssertions(t *testing.T) {
	a := mustExtract(t, `package x
import "testing"
func TestF(t *testing.T) {
	got := Sum(1, 2)
	if got != 3 { t.Fatal("x") }
}
`)
	b := mustExtract(t, `package x
import "testing"
func TestF(t *testing.T) {
	got := Sum(1, 2)
	if got != 4 { t.Fatal("x") }
}
`)
	c := mustExtract(t, `package x
import "testing"
func TestF(t *testing.T) {
	got := Sum(1, 5)
	if got != 3 { t.Fatal("x") }
}
`)
	if findTest(t, a, "TestF").BodyKey != findTest(t, b, "TestF").BodyKey {
		t.Fatal("changing an assertion changed the body key")
	}
	if findTest(t, a, "TestF").BodyKey == findTest(t, c, "TestF").BodyKey {
		t.Fatal("changing an input left the body key unchanged")
	}
}

func TestSetupCoversNonTestDeclarations(t *testing.T) {
	result := mustExtract(t, `package x
import "testing"
const limit = 3
func fixture() int { return 1 }
func TestA(t *testing.T) {}
`)
	if len(result.Setup) != 2 {
		t.Fatalf("setup = %+v", result.Setup)
	}
}

func TestFailingOnEqualityOnlyAssertsADifference(t *testing.T) {
	result := mustExtract(t, `package x
import "testing"
func TestNe(t *testing.T) {
	if got == 0 { t.Fatal("x") }
	if got != want {
	} else {
		t.Fatal("x")
	}
	if len(items) == 0 { t.Fatal("x") }
	if reflect.DeepEqual(a, b) { t.Fatal("x") }
	if got != want { t.Fatal("x") }
}
`)
	want := "notEqual,notEqual,notEqual,notEqual,equal"
	if got := strings.Join(matchers(findTest(t, result, "TestNe")), ","); got != want {
		t.Fatalf("matchers = %s, want %s", got, want)
	}
}
