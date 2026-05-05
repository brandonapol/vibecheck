## Test Integrity Protocol

This project uses vibecheck to measure test quality, not just test existence.

Your tests will be evaluated by:
1. **Mutation testing** — Stryker will mutate the source code and check if your tests catch the mutations. Weak assertions like `toBeDefined()` will fail. Write precise assertions.
2. **Hidden tests** — A separate test suite you cannot see will run against your implementation. Write code that satisfies the spec, not just the visible tests.
3. **Property-based tests** — Core modules require fast-check property tests. Write invariants, not just examples.
4. **Semantic analysis** — If you weaken an existing assertion, the CI will flag it.

Guidelines:
- Prefer `toBe` / `toEqual` / `toStrictEqual` over `toBeDefined` / `toBeTruthy`
- Write property-based tests for pure functions and data transformations
- Include edge cases: empty inputs, boundary values, error conditions
- If a test seems wrong, flag it in a comment for human review — do not weaken it
- Do not add `.skip` to existing tests
- Do not reduce the number of assertions in a test block
- Write tests first, then implementation — never in the same commit
