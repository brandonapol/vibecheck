import type { Config } from '../config/schema.js'

export type Violation = {
  file: string
  reason: 'protected-test-modified'
  phase: 'implementation'
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; violations: Violation[] }

export async function validate(_config: Config): Promise<ValidationResult> {
  return { ok: true }
}
