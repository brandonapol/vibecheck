import { mergeMutationReports, type CountedMutationReport } from '../analyzers/mutation.js'
import type { Config } from '../config/schema.js'
import { resolveLanguages } from './registry.js'

/** Runs mutation testing for every enabled language and merges the reports. */
export async function runMutationForLanguages(config: Config): Promise<CountedMutationReport> {
  const reports: CountedMutationReport[] = []
  for (const language of resolveLanguages(config)) {
    if (!language.enabled || !language.mutation.enabled) continue
    if (!language.adapter.runMutation) {
      throw new Error(
        `The '${language.id}' adapter cannot run mutation testing; ` +
          `set languages.${language.id}.mutation.enabled to false`,
      )
    }
    reports.push(
      await language.adapter.runMutation({
        include: language.mutation.include,
        exclude: language.mutation.exclude,
        protectedBranch: config.protectedBranch,
        mutation: config.mutation,
      }),
    )
  }
  return mergeMutationReports(reports)
}
