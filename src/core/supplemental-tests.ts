import micromatch from 'micromatch'

/** Extensions the pre-commit docs already call tests. They stay out of the
 *  default `testPatterns` array, which the schema test locks. */
export const TYPESCRIPT_SUPPLEMENTAL_GLOBS = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.test.js',
  '**/*.test.jsx',
  '**/*.test.mjs',
  '**/*.test.cjs',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.spec.js',
  '**/*.spec.jsx',
  '**/*.spec.mjs',
  '**/*.spec.cjs',
  '**/__tests__/**/*.ts',
  '**/__tests__/**/*.tsx',
  '**/__tests__/**/*.js',
  '**/__tests__/**/*.jsx',
  '**/__tests__/**/*.mjs',
  '**/__tests__/**/*.cjs',
]

export const GO_SUPPLEMENTAL_GLOBS = ['**/*_test.go']

export const DART_SUPPLEMENTAL_GLOBS = ['**/*_test.dart']

const SUPPLEMENTAL = [
  ...TYPESCRIPT_SUPPLEMENTAL_GLOBS,
  ...GO_SUPPLEMENTAL_GLOBS,
  ...DART_SUPPLEMENTAL_GLOBS,
]

export function isSupplementalTest(file: string): boolean {
  const path = file.replace(/\\/g, '/').replace(/^\.\//, '')
  return micromatch.isMatch(path, SUPPLEMENTAL)
}
