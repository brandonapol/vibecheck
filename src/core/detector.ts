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
