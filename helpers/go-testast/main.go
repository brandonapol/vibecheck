// Command go-testast reads a Go test file on stdin and prints the tests,
// assertions, and shared setup it contains as JSON, in the shape vibecheck's
// semantic diff compares (ExtractedTest[] and SetupStatement[]).
//
// Go has no matcher vocabulary, so an assertion is a failure call (t.Error,
// t.Fatal, ...) and the condition that guards it, a testify call, or a helper
// that takes the test's *testing.T. The condition decides the matcher name;
// the TypeScript side ranks it.
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"os"
	"reflect"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

type Assertion struct {
	Matcher      string   `json:"matcher"`
	Modifiers    []string `json:"modifiers"`
	Tautological bool     `json:"tautological"`
	Conditional  bool     `json:"conditional"`
	HasArguments bool     `json:"hasArguments"`
	Key          string   `json:"key"`
	Source       string   `json:"source"`
}

type Test struct {
	Name         string      `json:"name"`
	DescribePath []string    `json:"describePath"`
	ID           string      `json:"id"`
	Skipped      bool        `json:"skipped"`
	Assertions   []Assertion `json:"assertions"`
	Suspicious   []string    `json:"suspicious"`
	BodyKey      string      `json:"bodyKey"`
}

type Setup struct {
	Key    string `json:"key"`
	Source string `json:"source"`
}

type Result struct {
	Tests []Test  `json:"tests"`
	Setup []Setup `json:"setup"`
}

func main() {
	src, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	result, err := Extract(src)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// Extract parses one test file. Comments are not parsed, so they never
// affect a key.
func Extract(src []byte) (Result, error) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "input_test.go", src, parser.SkipObjectResolution)
	if err != nil {
		return Result{}, err
	}
	x := &extractor{
		fset:      fset,
		src:       src,
		file:      file,
		pkgTables: map[string]*ast.CompositeLit{},
		types:     map[string]ast.Expr{},
		expanded:  map[*ast.CompositeLit]bool{},
		tests:     []Test{},
	}
	x.indexFile()

	for _, decl := range file.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok {
			if tName, ok := testParam(fn); ok {
				x.extractTest(fn, tName)
			}
		}
	}
	return Result{Tests: x.tests, Setup: x.setup()}, nil
}

type extractor struct {
	fset *token.FileSet
	src  []byte
	file *ast.File
	// Package-level `var name = <composite literal>`, for table-driven tests.
	pkgTables map[string]*ast.CompositeLit
	// Package-level type declarations, to read a named row struct's fields.
	types map[string]ast.Expr
	// Tables whose rows became tests: compared row by row, so masked elsewhere.
	expanded map[*ast.CompositeLit]bool
	tests    []Test
}

func (x *extractor) indexFile() {
	for _, decl := range x.file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok {
			continue
		}
		for _, spec := range gen.Specs {
			switch s := spec.(type) {
			case *ast.TypeSpec:
				x.types[s.Name.Name] = s.Type
			case *ast.ValueSpec:
				if len(s.Names) == 1 && len(s.Values) == 1 {
					if lit, ok := s.Values[0].(*ast.CompositeLit); ok {
						x.pkgTables[s.Names[0].Name] = lit
					}
				}
			}
		}
	}
}

// testParam reports whether fn is a `func TestXxx(t *testing.T)` and returns
// the parameter's name.
func testParam(fn *ast.FuncDecl) (string, bool) {
	if fn.Recv != nil || !strings.HasPrefix(fn.Name.Name, "Test") {
		return "", false
	}
	rest := strings.TrimPrefix(fn.Name.Name, "Test")
	if r, _ := utf8.DecodeRuneInString(rest); rest != "" && unicode.IsLower(r) {
		return "", false
	}
	return testingParam(fn.Type)
}

// testingParam returns the name of the single *testing.T (or testing.TB)
// parameter of a function type.
func testingParam(ft *ast.FuncType) (string, bool) {
	if ft.Params == nil || len(ft.Params.List) != 1 {
		return "", false
	}
	field := ft.Params.List[0]
	typ := field.Type
	if star, ok := typ.(*ast.StarExpr); ok {
		typ = star.X
	}
	sel, ok := typ.(*ast.SelectorExpr)
	if !ok || !isIdent(sel.X, "testing") || (sel.Sel.Name != "T" && sel.Sel.Name != "TB") {
		return "", false
	}
	if len(field.Names) != 1 {
		return "_", true
	}
	return field.Names[0].Name, true
}

func (x *extractor) setup() []Setup {
	setup := []Setup{}
	for _, decl := range x.file.Decls {
		switch d := decl.(type) {
		case *ast.FuncDecl:
			if _, ok := testParam(d); ok {
				continue
			}
		case *ast.GenDecl:
			if d.Tok == token.IMPORT || x.isExpandedTableDecl(d) {
				continue
			}
		}
		setup = append(setup, Setup{Key: x.fingerprint(decl, nil), Source: x.source(decl)})
	}
	return setup
}

func (x *extractor) isExpandedTableDecl(d *ast.GenDecl) bool {
	for _, spec := range d.Specs {
		vs, ok := spec.(*ast.ValueSpec)
		if !ok || len(vs.Values) != 1 {
			return false
		}
		lit, ok := vs.Values[0].(*ast.CompositeLit)
		if !ok || !x.expanded[lit] {
			return false
		}
	}
	return len(d.Specs) > 0
}

// scope is one test being extracted: a top-level test, a t.Run subtest, or
// one row of an expanded table.
type scope struct {
	index   int // into x.tests
	id      string
	tName   string
	skipped bool
	// Local `name := <composite literal>` tables visible in this function.
	tables map[string]*ast.CompositeLit
	// Nodes masked out of this test's body key.
	masked map[ast.Node]string
}

func (x *extractor) extractTest(fn *ast.FuncDecl, tName string) {
	name := fn.Name.Name
	x.runScope(name, nil, tName, false, fn.Body, nil, func(s *scope) string {
		return x.fingerprint(fn.Body, s.masked)
	})
}

// runScope appends a test, walks its body, and fills in its body key last,
// once every assertion and subtest in the body is known and masked.
func (x *extractor) runScope(
	name string,
	parentPath []string,
	tName string,
	parentSkipped bool,
	body *ast.BlockStmt,
	tables map[string]*ast.CompositeLit,
	bodyKey func(*scope) string,
) {
	path := append([]string{}, parentPath...)
	id := strings.Join(append(append([]string{}, path...), name), "/")
	s := &scope{
		index:   len(x.tests),
		id:      id,
		tName:   tName,
		skipped: parentSkipped || (body != nil && x.hasSkip(body, tName)),
		tables:  map[string]*ast.CompositeLit{},
		masked:  map[ast.Node]string{},
	}
	for k, v := range tables {
		s.tables[k] = v
	}
	x.tests = append(x.tests, Test{
		Name:         name,
		DescribePath: path,
		ID:           id,
		Skipped:      s.skipped,
		Assertions:   []Assertion{},
		Suspicious:   []string{},
	})
	if body != nil {
		x.walkBlock(s, body.List, false, false)
	}
	x.tests[s.index].BodyKey = bodyKey(s)
}

func (x *extractor) childPath(s *scope) []string {
	return strings.Split(s.id, "/")
}

// hasSkip finds a t.Skip, t.Skipf, or t.SkipNow anywhere in the body, guarded
// or not, outside nested subtests. A conditional skip still means the test
// may not run, so it counts.
func (x *extractor) hasSkip(body *ast.BlockStmt, tName string) bool {
	found := false
	ast.Inspect(body, func(n ast.Node) bool {
		if found {
			return false
		}
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		if method, ok := tMethod(call, tName); ok {
			if method == "Run" {
				return false
			}
			if method == "Skip" || method == "Skipf" || method == "SkipNow" {
				found = true
				return false
			}
		}
		return true
	})
	return found
}

var failureMethods = map[string]bool{
	"Error": true, "Errorf": true, "Fatal": true, "Fatalf": true, "Fail": true, "FailNow": true,
}

// tMethod returns the method name when call is `<tName>.Method(...)`.
func tMethod(call *ast.CallExpr, tName string) (string, bool) {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || tName == "_" || !isIdent(sel.X, tName) {
		return "", false
	}
	return sel.Sel.Name, true
}

func (x *extractor) isFailureStmt(stmt ast.Stmt, tName string) bool {
	expr, ok := stmt.(*ast.ExprStmt)
	if !ok {
		return false
	}
	call, ok := expr.X.(*ast.CallExpr)
	if !ok {
		return false
	}
	method, ok := tMethod(call, tName)
	return ok && failureMethods[method]
}

func (x *extractor) containsFailure(block *ast.BlockStmt, tName string) bool {
	if block == nil {
		return false
	}
	for _, stmt := range block.List {
		if x.isFailureStmt(stmt, tName) {
			return true
		}
	}
	return false
}

// walkBlock visits statements. conditional is true once anything between the
// test root and here may not run. skipFailures drops failure calls that a
// guard has already turned into an assertion.
func (x *extractor) walkBlock(s *scope, stmts []ast.Stmt, conditional, skipFailures bool) {
	for _, stmt := range stmts {
		x.walkStmt(s, stmt, conditional, skipFailures)
	}
}

func (x *extractor) walkStmt(s *scope, stmt ast.Stmt, conditional, skipFailures bool) {
	switch n := stmt.(type) {
	case *ast.BlockStmt:
		x.walkBlock(s, n.List, conditional, false)
	case *ast.LabeledStmt:
		x.walkStmt(s, n.Stmt, conditional, skipFailures)
	case *ast.AssignStmt:
		x.recordLocalTables(s, n)
	case *ast.DeclStmt:
		x.recordLocalVarTables(s, n)
	case *ast.IfStmt:
		x.walkIf(s, n, conditional)
	case *ast.ForStmt:
		x.walkBlock(s, n.Body.List, true, false)
	case *ast.RangeStmt:
		x.walkRange(s, n, conditional)
	case *ast.SwitchStmt:
		x.walkSwitch(s, n, conditional)
	case *ast.TypeSwitchStmt:
		for _, clause := range n.Body.List {
			x.walkBlock(s, clause.(*ast.CaseClause).Body, true, false)
		}
	case *ast.SelectStmt:
		for _, clause := range n.Body.List {
			x.walkBlock(s, clause.(*ast.CommClause).Body, true, false)
		}
	case *ast.GoStmt:
		x.walkFuncLitCall(s, n.Call, conditional)
	case *ast.DeferStmt:
		x.walkFuncLitCall(s, n.Call, conditional)
	case *ast.ExprStmt:
		call, ok := n.X.(*ast.CallExpr)
		if !ok {
			return
		}
		if skipFailures && x.isFailureStmt(n, s.tName) {
			return
		}
		x.walkCall(s, n, call, conditional)
	}
}

func (x *extractor) walkFuncLitCall(s *scope, call *ast.CallExpr, conditional bool) {
	if lit, ok := call.Fun.(*ast.FuncLit); ok {
		x.walkBlock(s, lit.Body.List, conditional, false)
	}
}

func (x *extractor) walkIf(s *scope, n *ast.IfStmt, conditional bool) {
	elseBlock, _ := n.Else.(*ast.BlockStmt)
	switch {
	case x.containsFailure(n.Body, s.tName):
		x.addGuard(s, n, n.Init, n.Cond, true, conditional)
		x.walkBlock(s, n.Body.List, true, true)
		if n.Else != nil {
			x.walkStmt(s, n.Else, true, false)
		}
	case x.containsFailure(elseBlock, s.tName):
		x.addGuard(s, n, n.Init, n.Cond, false, conditional)
		x.walkBlock(s, n.Body.List, true, false)
		x.walkBlock(s, elseBlock.List, true, true)
	default:
		x.walkBlock(s, n.Body.List, true, false)
		if n.Else != nil {
			x.walkStmt(s, n.Else, true, false)
		}
	}
}

// walkSwitch treats each case of a tagless switch like an if/else-if chain.
func (x *extractor) walkSwitch(s *scope, n *ast.SwitchStmt, conditional bool) {
	for _, stmt := range n.Body.List {
		clause := stmt.(*ast.CaseClause)
		block := &ast.BlockStmt{List: clause.Body}
		if n.Tag == nil && len(clause.List) == 1 && x.containsFailure(block, s.tName) {
			x.addGuard(s, clause, nil, clause.List[0], true, conditional)
			x.walkBlock(s, clause.Body, true, true)
			continue
		}
		x.walkBlock(s, clause.Body, true, false)
	}
}

func (x *extractor) walkCall(s *scope, stmt *ast.ExprStmt, call *ast.CallExpr, conditional bool) {
	if method, ok := tMethod(call, s.tName); ok {
		switch {
		case method == "Run":
			x.walkSubtest(s, call, conditional)
		case failureMethods[method]:
			x.addAssertion(s, stmt, Assertion{
				Matcher:     "fail",
				Conditional: conditional,
				Key:         "fail",
				Source:      x.source(call),
			})
		case method == "Cleanup" && len(call.Args) == 1:
			if lit, ok := call.Args[0].(*ast.FuncLit); ok {
				x.walkBlock(s, lit.Body.List, conditional, false)
			}
		}
		return
	}
	if a, ok := x.testifyAssertion(s, call, conditional); ok {
		x.addAssertion(s, stmt, a)
		return
	}
	if name, ok := x.helperName(s, call); ok {
		x.addAssertion(s, stmt, Assertion{
			Matcher:      name,
			Conditional:  conditional,
			HasArguments: len(call.Args) > 1,
			Key:          "helper:" + x.fingerprint(call, nil),
			Source:       x.source(call),
		})
		return
	}
	x.walkFuncLitCall(s, call, conditional)
}

func (x *extractor) addAssertion(s *scope, node ast.Node, a Assertion) {
	a.Modifiers = []string{}
	x.tests[s.index].Assertions = append(x.tests[s.index].Assertions, a)
	s.masked[node] = "<assertion>"
}

func (x *extractor) addGuard(s *scope, node ast.Node, init ast.Stmt, cond ast.Expr, failWhen, conditional bool) {
	matcher := classify(cond, init, failWhen)
	end := cond.End()
	if ifStmt, ok := node.(*ast.IfStmt); ok {
		end = ifStmt.Body.Lbrace
	}
	x.addAssertion(s, node, Assertion{
		Matcher:      matcher,
		Tautological: tautological(cond, x),
		Conditional:  conditional,
		HasArguments: !weakNoArgument[matcher],
		Key:          fmt.Sprintf("if:%s;%s;%t", x.fingerprint(init, nil), x.fingerprint(cond, nil), failWhen),
		Source:       strings.TrimSpace(x.sourceRange(node.Pos(), end)),
	})
}

// Matchers with nothing meaningful to loosen, like Jest's toBeDefined().
var weakNoArgument = map[string]bool{
	"notNil": true, "isNil": true, "truthy": true, "anyError": true, "noError": true, "fail": true,
}

// Go matcher ranks, kept in step with GO_ASSERTION_STRENGTH on the TypeScript
// side. Used here only to pick the stronger side of && and ||.
var rank = map[string]int{
	"equal": 10, "deepEqual": 10, "length": 8, "bound": 7, "errorIs": 7, "contains": 6,
	"noError": 6, "predicate": 5, "anyError": 4, "notEqual": 4, "truthy": 3, "isNil": 3, "notNil": 2,
}

// classify names the check a guard condition performs. failWhen is whether
// the failure runs when cond is true (the if body) or false (the else).
func classify(cond ast.Expr, init ast.Stmt, failWhen bool) string {
	switch e := cond.(type) {
	case *ast.ParenExpr:
		return classify(e.X, init, failWhen)
	case *ast.UnaryExpr:
		if e.Op == token.NOT {
			return classify(e.X, init, !failWhen)
		}
	case *ast.BinaryExpr:
		switch e.Op {
		case token.LAND, token.LOR:
			left, right := classify(e.X, init, failWhen), classify(e.Y, init, failWhen)
			if rank[right] > rank[left] {
				return right
			}
			return left
		case token.EQL, token.NEQ:
			return classifyComparison(e, init, failWhen)
		case token.LSS, token.GTR, token.LEQ, token.GEQ:
			return "bound"
		}
	case *ast.CallExpr:
		return classifyCall(e, failWhen)
	case *ast.Ident, *ast.SelectorExpr:
		return "truthy"
	}
	return "predicate"
}

func classifyComparison(e *ast.BinaryExpr, init ast.Stmt, failWhen bool) string {
	// failsOnEqual: the failure runs when the two sides are equal.
	failsOnEqual := (e.Op == token.EQL) == failWhen
	for _, pair := range [][2]ast.Expr{{e.X, e.Y}, {e.Y, e.X}} {
		side, other := pair[0], pair[1]
		if isIdent(other, "nil") {
			if isErrorExpr(side) {
				if failsOnEqual {
					return "anyError"
				}
				return "noError"
			}
			if failsOnEqual {
				return "notNil"
			}
			return "isNil"
		}
		if isIdent(other, "true") || isIdent(other, "false") {
			return "truthy"
		}
		// Failing when the sides match only rules out one value.
		if failsOnEqual {
			return "notEqual"
		}
		if lit, ok := other.(*ast.BasicLit); ok && lit.Kind == token.STRING && lit.Value == `""` {
			if id, ok := side.(*ast.Ident); ok && assignedFromDiff(init, id.Name) {
				return "deepEqual"
			}
		}
		if call, ok := side.(*ast.CallExpr); ok && isIdent(call.Fun, "len") {
			return "length"
		}
	}
	if failsOnEqual {
		return "notEqual"
	}
	return "equal"
}

func classifyCall(call *ast.CallExpr, failWhen bool) string {
	switch callName(call) {
	case "reflect.DeepEqual", "cmp.Equal", "bytes.Equal", "slices.Equal", "maps.Equal", "proto.Equal":
		if failWhen {
			return "notEqual"
		}
		return "deepEqual"
	case "errors.Is", "errors.As":
		return "errorIs"
	case "strings.Contains", "strings.HasPrefix", "strings.HasSuffix", "bytes.Contains",
		"slices.Contains", "strings.ContainsAny", "strings.ContainsRune":
		return "contains"
	case "strings.EqualFold":
		return "equal"
	}
	return "predicate"
}

func assignedFromDiff(init ast.Stmt, name string) bool {
	assign, ok := init.(*ast.AssignStmt)
	if !ok || len(assign.Lhs) != 1 || len(assign.Rhs) != 1 || !isIdent(assign.Lhs[0], name) {
		return false
	}
	call, ok := assign.Rhs[0].(*ast.CallExpr)
	if !ok {
		return false
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	return ok && sel.Sel.Name == "Diff"
}

func isErrorExpr(e ast.Expr) bool {
	var name string
	switch v := e.(type) {
	case *ast.Ident:
		name = v.Name
	case *ast.SelectorExpr:
		name = v.Sel.Name
	default:
		return false
	}
	return name == "err" || strings.HasSuffix(name, "Err") || strings.HasSuffix(name, "err")
}

func tautological(cond ast.Expr, x *extractor) bool {
	switch e := cond.(type) {
	case *ast.ParenExpr:
		return tautological(e.X, x)
	case *ast.UnaryExpr:
		return e.Op == token.NOT && tautological(e.X, x)
	case *ast.Ident:
		return e.Name == "true" || e.Name == "false"
	case *ast.BinaryExpr:
		switch e.Op {
		case token.EQL, token.NEQ, token.LSS, token.GTR, token.LEQ, token.GEQ:
			if x.fingerprint(e.X, nil) == x.fingerprint(e.Y, nil) {
				return true
			}
			_, leftLit := e.X.(*ast.BasicLit)
			_, rightLit := e.Y.(*ast.BasicLit)
			return leftLit && rightLit
		}
	}
	return false
}

// testifyArity is how many arguments after t carry the check, so a trailing
// message never becomes part of the key. Missing entries keep every argument.
var testifyArity = map[string]int{
	"Equal": 2, "NotEqual": 2, "Exactly": 2, "EqualValues": 2, "NotEqualValues": 2, "Same": 2,
	"NotSame": 2, "JSONEq": 2, "YAMLEq": 2, "ElementsMatch": 2, "Len": 2, "Contains": 2,
	"NotContains": 2, "Subset": 2, "NotSubset": 2, "Regexp": 2, "NotRegexp": 2, "IsType": 2,
	"Implements": 2, "Greater": 2, "GreaterOrEqual": 2, "Less": 2, "LessOrEqual": 2,
	"ErrorIs": 2, "NotErrorIs": 2, "ErrorAs": 2, "ErrorContains": 2, "EqualError": 2,
	"PanicsWithValue": 2, "PanicsWithError": 2,
	"InDelta": 3, "InEpsilon": 3, "WithinDuration": 3,
	"True": 1, "False": 1, "Nil": 1, "NotNil": 1, "NoError": 1, "Error": 1, "Empty": 1,
	"NotEmpty": 1, "Zero": 1, "NotZero": 1, "Panics": 1, "NotPanics": 1, "Positive": 1, "Negative": 1,
}

var testifyEqualFamily = map[string]bool{
	"Equal": true, "Exactly": true, "EqualValues": true, "Same": true, "JSONEq": true, "YAMLEq": true,
	"ElementsMatch": true,
}

func (x *extractor) testifyAssertion(s *scope, call *ast.CallExpr, conditional bool) (Assertion, bool) {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || !(isIdent(sel.X, "assert") || isIdent(sel.X, "require")) {
		return Assertion{}, false
	}
	if len(call.Args) == 0 || !isIdent(call.Args[0], s.tName) {
		return Assertion{}, false
	}
	matcher := sel.Sel.Name
	if base := strings.TrimSuffix(matcher, "f"); base != matcher {
		if _, known := testifyArity[base]; known {
			matcher = base
		}
	}
	args := call.Args[1:]
	if n, ok := testifyArity[matcher]; ok && len(args) > n {
		args = args[:n]
	}
	taut := false
	switch {
	case testifyEqualFamily[matcher] && len(args) == 2:
		taut = x.fingerprint(args[0], nil) == x.fingerprint(args[1], nil)
	case matcher == "True" && len(args) == 1:
		taut = isIdent(args[0], "true")
	case matcher == "False" && len(args) == 1:
		taut = isIdent(args[0], "false")
	case matcher == "Nil" && len(args) == 1:
		taut = isIdent(args[0], "nil")
	}
	return Assertion{
		Matcher:      matcher,
		Tautological: taut,
		Conditional:  conditional,
		HasArguments: testifyArity[matcher] != 1,
		Key:          "testify:" + matcher + x.fingerprint(args, nil),
		Source:       x.source(call),
	}, true
}

// helperName returns the called function's name when a call passes the
// test's *testing.T on, the usual shape of an assertion helper.
func (x *extractor) helperName(s *scope, call *ast.CallExpr) (string, bool) {
	if s.tName == "_" {
		return "", false
	}
	passesT := false
	for _, arg := range call.Args {
		if isIdent(arg, s.tName) {
			passesT = true
		}
	}
	if !passesT {
		return "", false
	}
	switch fn := call.Fun.(type) {
	case *ast.Ident:
		return fn.Name, true
	case *ast.SelectorExpr:
		return fn.Sel.Name, true
	}
	return "", false
}

func (x *extractor) walkSubtest(s *scope, call *ast.CallExpr, conditional bool) {
	if len(call.Args) != 2 {
		return
	}
	name := subtestName(call.Args[0])
	lit, ok := call.Args[1].(*ast.FuncLit)
	s.masked[call] = "<subtest " + name + ">"
	if !ok {
		x.runScope(name, x.childPath(s), "_", s.skipped, nil, s.tables, func(*scope) string {
			return x.fingerprint(call.Args[1], nil)
		})
		return
	}
	tName, _ := testingParam(lit.Type)
	before := len(x.tests)
	x.runScope(name, x.childPath(s), tName, s.skipped, lit.Body, s.tables, func(child *scope) string {
		return x.fingerprint(lit.Body, child.masked)
	})
	if conditional {
		for i := before; i < len(x.tests); i++ {
			for j := range x.tests[i].Assertions {
				x.tests[i].Assertions[j].Conditional = true
			}
		}
	}
}

func subtestName(e ast.Expr) string {
	if lit, ok := e.(*ast.BasicLit); ok && lit.Kind == token.STRING {
		if v, err := strconv.Unquote(lit.Value); err == nil {
			return v
		}
	}
	return "<" + exprString(e) + ">"
}

func (x *extractor) recordLocalTables(s *scope, n *ast.AssignStmt) {
	if len(n.Lhs) != 1 || len(n.Rhs) != 1 {
		return
	}
	id, ok := n.Lhs[0].(*ast.Ident)
	if !ok {
		return
	}
	if lit, ok := n.Rhs[0].(*ast.CompositeLit); ok {
		s.tables[id.Name] = lit
	}
}

func (x *extractor) recordLocalVarTables(s *scope, n *ast.DeclStmt) {
	gen, ok := n.Decl.(*ast.GenDecl)
	if !ok {
		return
	}
	for _, spec := range gen.Specs {
		vs, ok := spec.(*ast.ValueSpec)
		if !ok || len(vs.Names) != 1 || len(vs.Values) != 1 {
			continue
		}
		if lit, ok := vs.Values[0].(*ast.CompositeLit); ok {
			s.tables[vs.Names[0].Name] = lit
		}
	}
}

func (x *extractor) resolveTable(s *scope, e ast.Expr) *ast.CompositeLit {
	switch v := e.(type) {
	case *ast.CompositeLit:
		return v
	case *ast.Ident:
		if lit, ok := s.tables[v.Name]; ok {
			return lit
		}
		return x.pkgTables[v.Name]
	}
	return nil
}

// walkRange expands a table-driven loop into one test per row when every
// row's subtest name is a literal; otherwise the loop is walked as code, and
// is conditional unless it ranges over a non-empty literal.
func (x *extractor) walkRange(s *scope, n *ast.RangeStmt, conditional bool) {
	table := x.resolveTable(s, n.X)
	if table != nil && x.expandTable(s, n, table, conditional) {
		return
	}
	loopConditional := conditional || table == nil || len(table.Elts) == 0
	x.walkBlock(s, n.Body.List, loopConditional, false)
}

func (x *extractor) expandTable(s *scope, n *ast.RangeStmt, table *ast.CompositeLit, conditional bool) bool {
	var run *ast.CallExpr
	for _, stmt := range n.Body.List {
		expr, ok := stmt.(*ast.ExprStmt)
		if !ok {
			continue
		}
		if call, ok := expr.X.(*ast.CallExpr); ok {
			if method, ok := tMethod(call, s.tName); ok && method == "Run" && len(call.Args) == 2 {
				run = call
			}
		}
	}
	if run == nil || len(table.Elts) == 0 {
		return false
	}
	lit, ok := run.Args[1].(*ast.FuncLit)
	if !ok {
		return false
	}
	names := x.rowNames(n, table, run.Args[0])
	if names == nil {
		return false
	}

	x.expanded[table] = true
	s.masked[table] = "<table>"
	s.masked[n] = "<table loop>"
	tName, _ := testingParam(lit.Type)
	for i, row := range table.Elts {
		row := row
		x.runScope(names[i], x.childPath(s), tName, s.skipped, lit.Body, s.tables, func(child *scope) string {
			loop := x.fingerprint(n.Body, map[ast.Node]string{lit.Body: x.fingerprint(lit.Body, child.masked)})
			return x.fingerprint(row, nil) + "|" + loop
		})
		if conditional {
			for j := range x.tests[len(x.tests)-1].Assertions {
				x.tests[len(x.tests)-1].Assertions[j].Conditional = true
			}
		}
	}
	return true
}

// rowNames resolves each row's subtest name, or returns nil if any row's
// name is not a string literal.
func (x *extractor) rowNames(n *ast.RangeStmt, table *ast.CompositeLit, nameExpr ast.Expr) []string {
	keyVar, _ := n.Key.(*ast.Ident)
	valueVar, _ := n.Value.(*ast.Ident)
	_, isMap := table.Type.(*ast.MapType)

	var field string
	var fieldIndex = -1
	switch e := nameExpr.(type) {
	case *ast.Ident:
		if !isMap || keyVar == nil || e.Name != keyVar.Name {
			return nil
		}
	case *ast.SelectorExpr:
		if valueVar == nil || !isIdent(e.X, valueVar.Name) {
			return nil
		}
		field = e.Sel.Name
		fieldIndex = x.fieldIndex(table, field)
	default:
		return nil
	}

	names := make([]string, 0, len(table.Elts))
	for _, elt := range table.Elts {
		row := elt
		if kv, ok := elt.(*ast.KeyValueExpr); ok {
			if field == "" {
				name, ok := stringLit(kv.Key)
				if !ok {
					return nil
				}
				names = append(names, name)
				continue
			}
			row = kv.Value
		}
		name, ok := rowField(row, field, fieldIndex)
		if !ok {
			return nil
		}
		names = append(names, name)
	}
	return names
}

func rowField(row ast.Expr, field string, index int) (string, bool) {
	if unary, ok := row.(*ast.UnaryExpr); ok && unary.Op == token.AND {
		row = unary.X
	}
	lit, ok := row.(*ast.CompositeLit)
	if !ok {
		return "", false
	}
	for i, elt := range lit.Elts {
		if kv, ok := elt.(*ast.KeyValueExpr); ok {
			if isIdent(kv.Key, field) {
				return stringLit(kv.Value)
			}
			continue
		}
		if i == index {
			return stringLit(elt)
		}
	}
	return "", false
}

// fieldIndex finds a field's position in the table's row struct, for rows
// written without field names.
func (x *extractor) fieldIndex(table *ast.CompositeLit, field string) int {
	var elem ast.Expr
	switch t := table.Type.(type) {
	case *ast.ArrayType:
		elem = t.Elt
	case *ast.MapType:
		elem = t.Value
	default:
		return -1
	}
	if star, ok := elem.(*ast.StarExpr); ok {
		elem = star.X
	}
	if id, ok := elem.(*ast.Ident); ok {
		elem = x.types[id.Name]
	}
	st, ok := elem.(*ast.StructType)
	if !ok {
		return -1
	}
	i := 0
	for _, f := range st.Fields.List {
		if len(f.Names) == 0 {
			i++
			continue
		}
		for _, name := range f.Names {
			if name.Name == field {
				return i
			}
			i++
		}
	}
	return -1
}

func stringLit(e ast.Expr) (string, bool) {
	lit, ok := e.(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return "", false
	}
	v, err := strconv.Unquote(lit.Value)
	return v, err == nil
}

func isIdent(e ast.Expr, name string) bool {
	id, ok := e.(*ast.Ident)
	return ok && id.Name == name
}

func callName(call *ast.CallExpr) string {
	switch fn := call.Fun.(type) {
	case *ast.Ident:
		return fn.Name
	case *ast.SelectorExpr:
		if pkg, ok := fn.X.(*ast.Ident); ok {
			return pkg.Name + "." + fn.Sel.Name
		}
		return fn.Sel.Name
	}
	return ""
}

func exprString(e ast.Expr) string {
	switch v := e.(type) {
	case *ast.Ident:
		return v.Name
	case *ast.SelectorExpr:
		return exprString(v.X) + "." + v.Sel.Name
	case *ast.CallExpr:
		return exprString(v.Fun) + "(...)"
	}
	return "expr"
}

func (x *extractor) source(n ast.Node) string {
	return x.sourceRange(n.Pos(), n.End())
}

func (x *extractor) sourceRange(from, to token.Pos) string {
	start, end := x.fset.Position(from).Offset, x.fset.Position(to).Offset
	if start < 0 || end > len(x.src) || start > end {
		return ""
	}
	return string(x.src[start:end])
}

var posType = reflect.TypeOf(token.NoPos)

// fingerprint serializes AST shape without positions, comments, or object
// resolution, so reformatting yields the same string. masked replaces the
// listed nodes with a marker.
func (x *extractor) fingerprint(node any, masked map[ast.Node]string) string {
	var b strings.Builder
	x.writeFingerprint(&b, reflect.ValueOf(node), masked)
	return b.String()
}

func (x *extractor) writeFingerprint(b *strings.Builder, v reflect.Value, masked map[ast.Node]string) {
	if !v.IsValid() {
		b.WriteString("nil")
		return
	}
	if v.Kind() == reflect.Interface {
		if v.IsNil() {
			b.WriteString("nil")
			return
		}
		v = v.Elem()
	}
	if v.Kind() == reflect.Ptr {
		if v.IsNil() {
			b.WriteString("nil")
			return
		}
		if node, ok := v.Interface().(ast.Node); ok {
			if marker, ok := masked[node]; ok {
				b.WriteString(marker)
				return
			}
			switch n := node.(type) {
			case *ast.Ident:
				b.WriteString(n.Name)
				return
			case *ast.BasicLit:
				b.WriteString(n.Kind.String() + ":" + n.Value)
				return
			}
		}
		v = v.Elem()
	}
	switch v.Kind() {
	case reflect.Struct:
		t := v.Type()
		b.WriteString(t.Name() + "{")
		for i := 0; i < v.NumField(); i++ {
			f := t.Field(i)
			if f.Type == posType || f.Name == "Obj" || f.Name == "Scope" || f.Name == "Doc" ||
				f.Name == "Comment" || f.Name == "Comments" || !f.IsExported() {
				continue
			}
			b.WriteString(f.Name + ":")
			x.writeFingerprint(b, v.Field(i), masked)
			b.WriteString(",")
		}
		b.WriteString("}")
	case reflect.Slice:
		b.WriteString("[")
		for i := 0; i < v.Len(); i++ {
			x.writeFingerprint(b, v.Index(i), masked)
			b.WriteString(",")
		}
		b.WriteString("]")
	default:
		fmt.Fprintf(b, "%v", v.Interface())
	}
}
