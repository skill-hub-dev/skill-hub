// client-switch: which client this session's project belongs to, on the band.
//
// Block 1 (2026-10-30): the roster (clients.ts) is read at session.start,
// before each prompt, and on a short poll, so an edit to clients.json shows
// without a restart. The band gets one line, 客戶：<name>, or a warning while
// the project is unassigned or the file cannot be read. The line goes above
// whatever the plugins beneath draw on the band, so another mod's band stays.
//
// Block 3 (2026-11-07): when the roster names a Skill Hub folder, the same
// refresh writes its tables (table.ts) and rebuilds Skill Hub, only when the
// tables changed, without holding up the prompt.

import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ClientMatch } from '../types'
import { bandLine, matchClient, parseRoster, rosterPath } from './clients'
import type { Roster } from './clients'
import { accountTable, tablePath } from './table'

const POLL_MS = 10_000
const BUILD_TIMEOUT_MS = 60_000

/** One Skill Hub rebuild at a time in this session. */
let isPublishing = false

const MATCH = { plugin: 'client-switch', key: 'match' } as const
const match = atom(MATCH, null)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    // A reload drops the old timer.
    $.clock.every(POLL_MS, () => refresh($))

    return result
  })

  on('prompt.submit', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const current = await read($, match)
    if (e.props.hasSurvey || current === null) {
      return below
    }

    const { Box, Text } = $.ui.resolve(e)
    const line = bandLine(current)
    const mine = (
      <Box flexDirection="row">
        {line.isWarning ? <Text color="warning">{line.text}</Text> : <Text color="success">{line.text}</Text>}
        {line.note && <Text dimColor>{line.note}</Text>}
      </Box>
    )
    if (!below) {
      return mine
    }

    return (
      <Box flexDirection="column">
        {mine}
        {below}
      </Box>
    )
  })
}

/** Reads the roster and the project's remote again, and writes the match when it changed. */
async function refresh($: EngineInterface): Promise<void> {
  const loaded = await loadRoster($)
  const next = 'kind' in loaded ? loaded : matchClient(loaded.roster, await $.session.root(), await originUrl($, await $.session.root()))
  const { value } = await $.state.get(MATCH)
  if (JSON.stringify(value ?? null) !== JSON.stringify(next)) {
    await $.state.set(MATCH, next)
  }
  if (!('kind' in loaded)) {
    void publishTable($, loaded.home, loaded.roster)
  }
}

/** The roster and the home folder it is under, or the match that says why there is none. */
async function loadRoster($: EngineInterface): Promise<{ home: string; roster: Roster } | ClientMatch> {
  const home = await $.env.get('USERPROFILE')
  if (home === undefined) {
    return { kind: 'error', reason: '找不到使用者資料夾（USERPROFILE）' }
  }
  const path = rosterPath(home)
  if (!(await $.fs.exists(path))) {
    return { kind: 'none', reason: 'no-roster' }
  }

  let text: string
  try {
    text = await $.fs.read(path)
  } catch {
    return { kind: 'error', reason: '讀不到檔案' }
  }
  const parsed = parseRoster(text)
  if ('error' in parsed) {
    return { kind: 'error', reason: parsed.error }
  }

  return { home, roster: parsed.roster }
}

/**
 * Writes the roster's tables for Skill Hub and rebuilds its dashboard, when
 * the file on disk says something else. A failed build is left for the next
 * roster change; Skill Hub's own update rebuilds it too.
 */
async function publishTable($: EngineInterface, home: string, roster: Roster): Promise<void> {
  if (roster.skillHub === undefined || isPublishing) {
    return
  }
  isPublishing = true
  try {
    const file = tablePath(home)
    const text = `${JSON.stringify(accountTable(roster), null, 2)}\n`
    const old = (await $.fs.exists(file)) ? await $.fs.read(file) : ''
    if (old === text) {
      return
    }
    await $.fs.write(file, text)
    await $.process.run(['node', 'bin/skill-hub.mjs', 'build'], { cwd: roster.skillHub, timeoutMs: BUILD_TIMEOUT_MS })
  } catch {
    // Skill Hub moved or would not build: the band still works
  } finally {
    isPublishing = false
  }
}

/** The project's origin remote, or undefined outside git or without one. */
async function originUrl($: EngineInterface, root: string): Promise<string | undefined> {
  try {
    const result = await $.process.run(['git', 'remote', 'get-url', 'origin'], { cwd: root, timeoutMs: 5_000 })
    return result.exitCode === 0 ? result.stdout.trim() : undefined
  } catch {
    return undefined
  }
}
