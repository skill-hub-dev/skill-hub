import type { On } from 'claude-code'

import { describe, expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const ROOT = 'C:\\work\\my-shop'
const START = { cwd: ROOT, surface: 'desktop', isInteractive: true } as const
const ROSTER_PATH = 'C:/Users/u/.claude/clients.json'

const ROSTER = JSON.stringify({
  clients: { 甲公司: { github: { owners: ['example'] } } },
})

/**
 * This session in my-shop, its origin on GitHub, and clients.json when given;
 * beneath the band, another mod's line when given, else the engine's empty band.
 */
function world(on: On, options: { roster?: string; remote?: string; beneath?: string }) {
  const key = (path: string) => path.replace(/\\/g, '/')
  mock.clock(on, { now: 1_000 })
  on('session.start', () => ({ cwd: ROOT }))
  on('session.root', () => ({ value: ROOT }))
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? 'C:\\Users\\u' : undefined }))
  on('fs.exists', ($, e) => ({ value: options.roster !== undefined && key(e.path) === ROSTER_PATH }))
  on('fs.read', ($, e) => ({ value: key(e.path) === ROSTER_PATH ? (options.roster ?? '') : '' }))
  on('process.run', () => ({
    value: {
      exitCode: options.remote === undefined ? 2 : 0,
      stdout: options.remote === undefined ? '' : `${options.remote}\n`,
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return options.beneath === undefined ? <Box /> : <Text>{options.beneath}</Text>
  })
}

describe('the band', () => {
  test('names the client the git remote belongs to', async ($, on) => {
    world(on, { roster: ROSTER, remote: 'https://github.com/example/shop.git' })
    await $.session.start(START)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'client-switch', surface, ...BAND })
      expect(await ui.find({ type: 'Text', text: '客戶：甲公司' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '（依 git remote 判斷）' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('warns while the project is unassigned or there is no roster yet', async ($, on) => {
    world(on, { roster: ROSTER, remote: 'https://github.com/<owner>/else.git' })
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: 'client-switch', surface: 'desktop', ...BAND })
    expect(await ui.find({ type: 'Text', text: '客戶：未指定' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '（名冊裡沒有這個專案）' })).toBeDefined()
    await ui.unmount()
  })

  test('says clients.json is broken rather than guessing', async ($, on) => {
    world(on, { roster: '{ "clients": ', remote: 'https://github.com/example/shop.git' })
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: 'client-switch', surface: 'desktop', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'clients.json 有誤：不是有效的 JSON' })).toBeDefined()
    await ui.unmount()
  })

  test("keeps what the band beneath draws, under the client's line", async ($, on) => {
    world(on, { beneath: '另一個 mod 的橫條' })
    await $.session.start(START)

    const ui = await $.ui.mount({ plugin: 'client-switch', surface: 'desktop', ...BAND })
    expect(await ui.find({ type: 'Text', text: '客戶：未指定' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '（還沒建 ~/.claude/clients.json）' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '另一個 mod 的橫條' })).toBeDefined()
    await ui.unmount()
  })
})
