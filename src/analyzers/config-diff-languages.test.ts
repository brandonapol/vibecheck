import { describe, it, expect, afterEach } from 'vitest'
import { detectConfigWeakening } from './config-diff.js'
import { defineConfig } from '../config/schema.js'
import { registerAdapter } from '../languages/registry.js'
import { makeStubAdapter } from '../../test/__tests__/stub-adapter.js'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function withStub() {
  cleanups.push(registerAdapter(makeStubAdapter()))
}

const fields = (before: Parameters<typeof defineConfig>[0], after: Parameters<typeof defineConfig>[0]) =>
  detectConfigWeakening(defineConfig(before), defineConfig(after)).map(v => v.field)

describe('detectConfigWeakening — languages', () => {
  it('flags dropping the implicit typescript language for an explicit list', () => {
    withStub()
    expect(fields({}, { languages: { stub: {} } })).toEqual(['languages.typescript.enabled'])
  })

  it('accepts making the implicit typescript language explicit with the same settings', () => {
    expect(fields({}, { languages: { typescript: {} } })).toEqual([])
  })

  it('flags a language being disabled', () => {
    withStub()
    expect(fields({ languages: { stub: {} } }, { languages: { stub: { enabled: false } } })).toEqual([
      'languages.stub.enabled',
    ])
  })

  it('flags mutation being disabled for one language', () => {
    withStub()
    expect(
      fields({ languages: { stub: {} } }, { languages: { stub: { mutation: { enabled: false } } } }),
    ).toEqual(['languages.stub.mutation.enabled'])
  })

  it('flags removed test patterns, removed includes, and added excludes', () => {
    withStub()
    expect(
      fields(
        { languages: { stub: { testPatterns: ['**/*.stub', '**/*.stubtest'], mutation: { include: ['a/**', 'b/**'] } } } },
        { languages: { stub: { testPatterns: ['**/*.stub'], mutation: { include: ['a/**'], exclude: ['a/gen/**'] } } } },
      ),
    ).toEqual(['languages.stub.testPatterns', 'languages.stub.mutation.include', 'languages.stub.mutation.exclude'])
  })

  it('accepts adding a language', () => {
    withStub()
    expect(fields({ languages: { typescript: {} } }, { languages: { typescript: {}, stub: {} } })).toEqual([])
  })

  it('does not double-report top-level changes for the implicit typescript language', () => {
    expect(fields({}, { mutation: { include: [] } })).toEqual(['mutation.include'])
  })
})

describe('detectConfigWeakening — composite threshold', () => {
  it('flags lowering the composite threshold', () => {
    expect(fields({ threshold: 80 }, { threshold: 60 })).toEqual(['threshold'])
  })

  it('accepts raising it', () => {
    expect(fields({ threshold: 80 }, { threshold: 90 })).toEqual([])
  })
})

describe('detectConfigWeakening — commit enforcement levels', () => {
  it('flags lowering enforcement for unknown commits', () => {
    expect(fields({}, { enforcement: { unknown: 'warn' } })).toEqual(['enforcement.unknown'])
  })

  it('flags lowering enforcement for agent commits', () => {
    expect(fields({}, { enforcement: { agents: 'off' } })).toEqual(['enforcement.agents'])
  })

  it('accepts raising one', () => {
    expect(fields({ enforcement: { unknown: 'warn' } }, { enforcement: { unknown: 'block' } })).toEqual([])
  })

  it('flags removing an agent environment variable', () => {
    expect(fields({}, { agentEnvVars: [] })).toEqual(['agentEnvVars'])
  })
})

describe('detectConfigWeakening — protected branch', () => {
  it('flags repointing protectedBranch', () => {
    expect(fields({}, { protectedBranch: 'my-feature' })).toEqual(['protectedBranch'])
  })
})

describe('detectConfigWeakening — protected tests', () => {
  const rule = { path: 'packages/*/test/**', references: ['narrowViewport', 'wideViewport'] }

  it('flags a protected file being removed from the list', () => {
    expect(fields({ protectedTests: { files: ['a_test.dart', 'b_test.dart'] } }, { protectedTests: { files: ['a_test.dart'] } })).toEqual([
      'protectedTests.files',
    ])
  })

  it('flags a required rule being removed', () => {
    expect(fields({ protectedTests: { required: [rule] } }, { protectedTests: { required: [] } })).toEqual([
      'protectedTests.required',
    ])
  })

  it('flags an identifier being dropped from a rule', () => {
    expect(
      fields(
        { protectedTests: { required: [rule] } },
        { protectedTests: { required: [{ ...rule, references: ['wideViewport'] }] } },
      ),
    ).toEqual(['protectedTests.required'])
  })

  it('accepts adding protection', () => {
    expect(fields({}, { protectedTests: { files: ['a_test.dart'], required: [rule] } })).toEqual([])
  })
})
