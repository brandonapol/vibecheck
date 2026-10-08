import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createHelperExtractor, type HelperSpec } from './helper.js'

describe('helper builds', () => {
  it('compiles the same helper twice at once without losing the binary', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'vibecheck-helper-'))
    let started = 0
    let release: () => void = () => {}
    const bothStarted = new Promise<void>(resolve => {
      release = resolve
    })
    const spec: HelperSpec = {
      dir: 'go-testast',
      sources: ['go.mod', 'main.go'],
      toolchainName: 'Race toolchain',
      languageKey: 'race',
      build: async (_toolchain, _sourceDir, output) => {
        started += 1
        if (started === 2) release()
        await bothStarted
        writeFileSync(
          output,
          "#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '{\"tests\":[],\"setup\":[]}'\n",
        )
        chmodSync(output, 0o755)
      },
    }
    const left = createHelperExtractor(spec, { toolchain: 'unused', cacheDir })
    const right = createHelperExtractor(spec, { toolchain: 'unused', cacheDir })

    const [a, b] = await Promise.all([
      left('package a', 'a_test.go'),
      right('package b', 'b_test.go'),
    ])

    expect(started).toBe(2)
    expect(a).toEqual({ tests: [], setup: [] })
    expect(b).toEqual({ tests: [], setup: [] })
  })
})
