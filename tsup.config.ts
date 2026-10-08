import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'bin/vibecheck': 'bin/vibecheck.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  shims: true,
  // jiti resolves the user's config at runtime and ships its own files.
  external: ['jiti'],
})
