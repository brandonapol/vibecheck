export { defineConfig, defaultConfig } from './config/schema.js'
export type { Config } from './config/schema.js'
export { loadConfig } from './config/loader.js'
export { getProtectedPaths, getStagedFiles, matchesPatterns, fileExistsInBranch } from './core/resolver.js'
