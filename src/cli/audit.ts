import { execa } from 'execa'
import type { Config } from '../config/schema.js'
import { detectAgentTrailers } from '../core/detector.js'
import { matchesPatterns } from '../core/resolver.js'
import { patternsForConfig } from '../core/test-patterns.js'

export type AuditFile = {
  status: string
  path: string
  previousPath?: string
}

export type AuditCommit = {
  sha: string
  message: string
  files: AuditFile[]
}

export type AuditHit = {
  sha: string
  signal: string
  files: string[]
}

const STATUS_LINE = /^([AMDTRC])\d*$/

/**
 * History scan uses commit trailers only. The current process environment
 * would mark every commit as an agent whenever this command runs inside one.
 */
export function findAuditHits(commits: AuditCommit[], config: Config): AuditHit[] {
  const hits: AuditHit[] = []
  const patterns = patternsForConfig(config)
  for (const entry of commits) {
    const trailer = detectAgentTrailers(entry.message, config.agentTrailers)
    if (!trailer.isAgent || !trailer.matchedTrailer) continue
    const files: string[] = []
    for (const file of entry.files) {
      const kind = file.status[0]
      if (kind === 'A') continue
      if (kind === 'R' || kind === 'C') {
        if (file.previousPath && matchesPatterns(file.previousPath, patterns)) {
          files.push(file.previousPath)
        }
        continue
      }
      if (matchesPatterns(file.path, patterns)) files.push(file.path)
    }
    if (files.length > 0) {
      hits.push({ sha: entry.sha, signal: `trailer:${trailer.matchedTrailer}`, files })
    }
  }
  return hits
}

/** `git log --pretty=tformat:'COMMIT %H%n%B%nENDMSG %H' --name-status`. */
export function parseAuditLog(text: string): AuditCommit[] {
  if (text.trim() === '') return []
  const lines = text.split('\n')
  const commits: AuditCommit[] = []
  let index = 0

  while (index < lines.length) {
    if (lines[index] === '') {
      index++
      continue
    }
    const header = lines[index]
    if (!header.startsWith('COMMIT ')) {
      throw new Error(`vibecheck audit: expected COMMIT, saw ${header}`)
    }
    const sha = header.slice('COMMIT '.length)
    index++
    const messageLines: string[] = []
    let ended = false
    while (index < lines.length) {
      if (lines[index] === `ENDMSG ${sha}`) {
        ended = true
        index++
        break
      }
      messageLines.push(lines[index])
      index++
    }
    if (!ended) throw new Error(`vibecheck audit: commit ${sha} has no ENDMSG`)

    const files: AuditFile[] = []
    while (index < lines.length && !lines[index].startsWith('COMMIT ')) {
      const line = lines[index]
      index++
      if (line === '') continue
      const parts = line.split('\t')
      const match = STATUS_LINE.exec(parts[0] ?? '')
      if (!match || !parts[1]) throw new Error(`vibecheck audit: unreadable name-status line ${line}`)
      const status = match[1]
      if (status === 'R' || status === 'C') {
        if (!parts[2]) throw new Error(`vibecheck audit: rename is missing a path in ${line}`)
        files.push({ status, previousPath: parts[1], path: parts[2] })
      } else {
        files.push({ status, path: parts[1] })
      }
    }

    commits.push({ sha, message: messageLines.join('\n').replace(/\n+$/, ''), files })
  }

  return commits
}

export function formatAudit(hits: AuditHit[]): string {
  if (hits.length === 0) return 'vibecheck audit: no agent commits modified protected tests\n'
  const noun = hits.length === 1 ? 'commit' : 'commits'
  const lines = [`vibecheck audit: ${hits.length} ${noun} modified protected tests`, '']
  for (const hit of hits) {
    lines.push(`${hit.sha.slice(0, 12)}  ${hit.signal}`)
    for (const file of hit.files) lines.push(`  ${file}`)
  }
  return `${lines.join('\n')}\n`
}

/** Default is every commit reachable from HEAD. `--since <ref>` is `<ref>..HEAD`. */
export function auditRange(since?: string): string {
  if (!since) return 'HEAD'
  if (since.startsWith('-') || /\s/.test(since)) {
    throw new Error('vibecheck audit: --since must be a revision, not an option')
  }
  return `${since}..HEAD`
}

export async function loadAuditCommits(cwd: string, range = 'HEAD'): Promise<AuditCommit[]> {
  const { stdout } = await execa(
    'git',
    ['--no-pager', 'log', range, '--pretty=tformat:COMMIT %H%n%B%nENDMSG %H', '--name-status', '--diff-filter=AMDRTC'],
    { cwd },
  )
  return parseAuditLog(stdout)
}
