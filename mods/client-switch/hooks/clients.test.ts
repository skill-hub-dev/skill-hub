import { describe, expect, test } from 'claude-code/testing'

import { bandLine, matchClient, normalizePath, parseRoster, remoteOwner, rosterPath } from './clients'
import type { Roster } from './clients'

const ROSTER = JSON.stringify({
  clients: {
    甲公司: { github: { owners: ['example'], email: 'you@example.com' } },
    乙工作室: { github: { owners: ['your-name'] } },
  },
  projects: {
    'C:\\work\\my-shop': { client: '甲公司', links: { vercel: 'my-shop' } },
    'C:/work/agency': { client: '乙工作室' },
    'C:/work/丙商行': { client: '甲公司' },
    'C:/work/丙商行/.deploy/acme-web': { client: '甲公司', accounts: { github: '乙工作室' } },
    'C:/work/radar-app': {
      client: '甲公司',
      accounts: { github: '乙工作室', cloudflare: '乙工作室', supabase: '甲公司' },
      deploy: 'Cloudflare Workers radar-app',
    },
  },
})

function roster(): Roster {
  const parsed = parseRoster(ROSTER)
  if ('error' in parsed) {
    throw new Error(parsed.error)
  }
  return parsed.roster
}

describe('parseRoster', () => {
  test('reads clients and projects', () => {
    const { clients, projects } = roster()
    expect(Object.keys(clients)).toEqual(['甲公司', '乙工作室'])
    expect(projects['C:/work/agency']).toEqual({ client: '乙工作室' })
  })

  test('says what is wrong, in Chinese', () => {
    expect(parseRoster('{ nope')).toEqual({ error: '不是有效的 JSON' })
    expect(parseRoster('{}')).toEqual({ error: '缺少 "clients"' })
    expect(parseRoster('{"clients":{"甲":{"github":{"owners":"acme"}}}}')).toEqual({
      error: '客戶「甲」的 github.owners 要是字串陣列',
    })
    expect(parseRoster('{"clients":{"甲":{}},"projects":{"D:/x":{"client":"甲","accounts":{"github":"丙"}}}}')).toEqual({
      error: '專案 D:/x 的 accounts.github 指到不存在的客戶「丙」',
    })
    expect(parseRoster('{"clients":{"甲":{}},"projects":{"D:/x":{"client":"甲","accounts":{"aws":"甲"}}}}')).toEqual({
      error: '專案 D:/x 的 accounts 有不認得的服務「aws」',
    })
    expect(parseRoster('{"clients":{"甲":{}},"projects":{"D:/x":{"client":"甲","gitAs":"甲"}}}')).toEqual({
      error: '專案 D:/x 的 gitAs 已改成 accounts.github',
    })
    expect(parseRoster('{"clients":{},"projects":{"D:/x":{"client":"乙"}}}')).toEqual({
      error: '專案 D:/x 指到不存在的客戶「乙」',
    })
  })
})

describe('remoteOwner', () => {
  test('https, with or without a user, and ssh in both spellings', () => {
    expect(remoteOwner('https://github.com/example/shop.git')).toBe('example')
    expect(remoteOwner('https://git@github.com/example/tool-repo')).toBe('example')
    expect(remoteOwner('git@github.com:acme/site.git')).toBe('acme')
    expect(remoteOwner('ssh://git@github.com/acme/site.git')).toBe('acme')
    expect(remoteOwner('git@github.com-acme:acme/site.git')).toBe('acme')
  })

  test('nothing for a remote elsewhere', () => {
    expect(remoteOwner('https://example.com/acme/site.git')).toBeUndefined()
    expect(remoteOwner('D:/repos/site.git')).toBeUndefined()
  })
})

describe('matchClient', () => {
  test('the projects list wins, in any spelling of the path, subfolders included', () => {
    expect(matchClient(roster(), 'c:/work/my-shop/')).toEqual({ kind: 'client', name: '甲公司', source: 'project' })
    expect(matchClient(roster(), 'C:\\work\\agency\\_offical\\_web\\next', 'https://github.com/example/x')).toEqual({
      kind: 'client',
      name: '乙工作室',
      source: 'project',
    })
  })

  test("services under another client's account: still this client, those services as the other", () => {
    expect(matchClient(roster(), 'C:/work/丙商行/.deploy/acme-web', 'https://github.com/example/acme-web.git')).toEqual({
      kind: 'client',
      name: '甲公司',
      source: 'project',
      accounts: { github: '乙工作室' },
    })
    expect(matchClient(roster(), 'C:/work/丙商行/n8n')).toEqual({ kind: 'client', name: '甲公司', source: 'project' })
    // supabase names the project's own client, so it is not another's
    expect(matchClient(roster(), 'C:/work/radar-app')).toEqual({
      kind: 'client',
      name: '甲公司',
      source: 'project',
      accounts: { github: '乙工作室', cloudflare: '乙工作室' },
    })
  })

  test('the band names the borrowed services, grouped by whose they are', () => {
    expect(bandLine({ kind: 'client', name: '甲公司', source: 'project', accounts: { github: '乙工作室' } }).note).toBe(
      '（專案設定；GitHub 用乙工作室的帳號）',
    )
    expect(
      bandLine({ kind: 'client', name: '丙商行', source: 'project', accounts: { cloudflare: '乙工作室', vercel: '甲公司', github: '乙工作室' } })
        .note,
    ).toBe('（專案設定；GitHub、Cloudflare 用乙工作室的帳號；Vercel 用甲公司的帳號）')
    expect(bandLine({ kind: 'client', name: '甲公司', source: 'project' }).note).toBe('（專案設定）')
  })

  test('a folder that only starts with a listed name is not inside it', () => {
    expect(matchClient(roster(), 'C:/work/acme-crm')).toEqual({ kind: 'none', reason: 'no-match' })
  })

  test('otherwise the remote owner says whose it is', () => {
    expect(matchClient(roster(), 'C:/work/cc-mods/tool-repo', 'https://github.com/example/tool-repo.git')).toEqual({
      kind: 'client',
      name: '甲公司',
      source: 'remote',
    })
  })

  test('unassigned when neither matches', () => {
    expect(matchClient(roster(), 'C:/work/tmp', 'https://github.com/<owner>/else.git')).toEqual({ kind: 'none', reason: 'no-match' })
    expect(matchClient(roster(), 'C:/work/tmp')).toEqual({ kind: 'none', reason: 'no-match' })
  })
})

test('paths and the roster file', () => {
  expect(normalizePath('C:\\Work\\Site\\')).toBe('c:/work/site')
  expect(rosterPath('C:\\Users\\u')).toBe('C:\\Users\\u/.claude/clients.json')
})

test('the band line: green for a client, a warning otherwise', () => {
  expect(bandLine({ kind: 'client', name: '甲公司', source: 'remote' })).toEqual({
    text: '客戶：甲公司',
    note: '（依 git remote 判斷）',
    isWarning: false,
  })
  expect(bandLine({ kind: 'none', reason: 'no-roster' }).isWarning).toBe(true)
  expect(bandLine({ kind: 'error', reason: '不是有效的 JSON' })).toEqual({ text: 'clients.json 有誤：不是有效的 JSON', isWarning: true })
})
