import { expect, test } from 'claude-code/testing'

import { parseRoster } from './clients'
import type { Roster } from './clients'
import { accountTable, tablePath } from './table'

const ROSTER = JSON.stringify({
  clients: {
    乙工作室: { github: { owners: ['your-name'], user: 'your-name' }, cloudflare: { accounts: ['cf123'] } },
    丙商行: { github: { owners: ['acme'], user: 'acme', email: 'a@b.c' }, vercel: { team: 'acme-team' } },
  },
  projects: {
    'C:/work/雷達專案': {
      client: '丙商行',
      accounts: { github: '乙工作室', cloudflare: '乙工作室', supabase: '丙商行' },
      deploy: 'Cloudflare Workers',
      links: { github: 'your-name/radar-app', 'cloudflare-worker': 'radar-app' },
    },
    'C:\\work\\acme-site': { client: '丙商行', links: { 'vercel-site': 'acme-site', 'vercel-backend': 'acme-backend' } },
  },
  skillHub: 'C:/work/skill-hub',
})

function view(index: number) {
  const found = accountTable(roster()).views[index]
  if (found === undefined) {
    throw new Error(`no view ${index}`)
  }
  return found
}

function roster(): Roster {
  const parsed = parseRoster(ROSTER)
  if ('error' in parsed) {
    throw new Error(parsed.error)
  }
  return parsed.roster
}

test('three views, in the order the menu shows them', () => {
  const table = accountTable(roster())
  expect(table.title).toBe('帳號對照')
  expect(table.views.map(view => view.title)).toEqual(['依專案', '依客戶', '依服務'])
  expect(roster().skillHub).toBe('C:/work/skill-hub')
})

test('by project: whose account each service uses, with its name there; — for one the roster does not record', () => {
  const byProject = view(0)
  expect(byProject.columns).toEqual(['專案', '客戶', 'GitHub', 'Vercel', 'Supabase', 'Cloudflare', 'Google', '部署'])
  expect(byProject.rows).toEqual([
    ['雷達專案', '丙商行', '乙工作室：your-name/radar-app', '—', '丙商行', '乙工作室：radar-app', '—', 'Cloudflare Workers'],
    ['acme-site', '丙商行', '—', '丙商行：acme-site、acme-backend', '—', '—', '—', '—'],
  ])
})

test("by client: its accounts, its projects, and others' projects that borrow it", () => {
  const byClient = view(1)
  expect(byClient.rows[0]).toEqual(['乙工作室', 'your-name', '—', '—', 'cf123', '—', '雷達專案（屬於丙商行；GitHub、Cloudflare）'])
  expect(byClient.rows[1]).toEqual(['丙商行', 'acme（a@b.c）', 'acme-team', '—', '—', '—', '雷達專案、acme-site'])
})

test('by service: one row per project using it, under whose account', () => {
  const byService = view(2)
  expect(byService.rows).toEqual([
    ['GitHub', '乙工作室：your-name', '雷達專案', 'your-name/radar-app'],
    ['Vercel', '丙商行：acme-team', 'acme-site', 'acme-site、acme-backend'],
    ['Supabase', '丙商行', '雷達專案', '—'],
    ['Cloudflare', '乙工作室：cf123', '雷達專案', 'radar-app'],
  ])
})

test('the table file sits beside the roster', () => {
  expect(tablePath('C:\\Users\\u\\')).toBe('C:\\Users\\u/.claude/client-switch/skill-hub-table.json')
  expect(parseRoster('{"clients":{},"skillHub":3}')).toEqual({ error: '"skillHub" 要是資料夾路徑' })
})
