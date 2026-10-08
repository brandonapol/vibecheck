package fixture

import "testing"

func TestWeak(t *testing.T) {
	// Covered, but the result is never checked, so arithmetic mutants live.
	Weak(1)
}
