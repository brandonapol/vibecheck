import { execa } from 'execa'

export async function getCommitMessage(): Promise<string> {
  try {
    const result = await execa('git', ['log', '-1', '--format=%B'])
    return result.stdout
  } catch {
    return ''
  }
}

export async function isAgentCommit(
  trailers: string[],
  commitMessage?: string,
): Promise<boolean> {
  const message = commitMessage ?? await getCommitMessage()
  if (!message) return false

  const lines = message.split('\n')
  return trailers.some(trailer =>
    lines.some(line => line.toLowerCase().includes(trailer.toLowerCase()))
  )
}
