export type AgentDetectionResult = {
  isAgent: boolean
  matchedTrailer: string | null
}

export function detectAgentTrailers(
  commitMessage: string,
  trailers: string[],
): AgentDetectionResult {
  const messageLower = commitMessage.toLowerCase()
  for (const trailer of trailers) {
    if (messageLower.includes(trailer.toLowerCase())) {
      return { isAgent: true, matchedTrailer: trailer }
    }
  }
  return { isAgent: false, matchedTrailer: null }
}

export async function isAgentCommit(
  trailers: string[],
  getCommitMessage: () => Promise<string>,
): Promise<AgentDetectionResult> {
  const message = await getCommitMessage()
  return detectAgentTrailers(message, trailers)
}

export type AgentIdentity = 'agent' | 'unknown'

export type AgentSignals = {
  commitMessage: string
  trailers: string[]
  env: Record<string, string | undefined>
  envVars: string[]
}

export type IdentityResult = {
  identity: AgentIdentity
  /** `trailer:<trailer>` or `env:<name>`; null when nothing matched. */
  matchedSignal: string | null
}

/** Every signal here is advisory: an agent that strips its trailer and
 *  unsets its environment reads as `unknown`, which is why `unknown` is
 *  enforced strictly by default. Nothing can prove a commit is human. */
export function detectAgent({ commitMessage, trailers, env, envVars }: AgentSignals): IdentityResult {
  const trailer = detectAgentTrailers(commitMessage, trailers)
  if (trailer.isAgent) return { identity: 'agent', matchedSignal: `trailer:${trailer.matchedTrailer}` }
  const variable = envVars.find(name => (env[name] ?? '') !== '')
  if (variable) return { identity: 'agent', matchedSignal: `env:${variable}` }
  return { identity: 'unknown', matchedSignal: null }
}
