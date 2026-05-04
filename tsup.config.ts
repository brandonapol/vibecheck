import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'bin/agent-tdd': 'bin/agent-tdd.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  shims: true,
})
