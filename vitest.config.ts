import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Pin the project root so a probe cannot widen discovery to the filesystem.
// A CLI `--root` still overrides this; never pass one above the repo.
const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  test: {
    root,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
