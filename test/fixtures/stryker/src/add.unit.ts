import { expect, test } from 'vitest'
import { add } from './add'

test('adds two numbers', () => {
  expect(add(1, 2)).toBe(3)
  expect(add(-1, 1)).toBe(0)
})
