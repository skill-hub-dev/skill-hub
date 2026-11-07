// client-switch: block 3, the roster as tables for Skill Hub (2026-11-07).
// Skill Hub's custom tables take { title, description, views: [{ title,
// note, columns, rows }] }, every cell text; it shows one tab with a menu of
// views. Three views: by project, by client, by service.
// Pure: register.tsx writes the file and rebuilds Skill Hub.

import type { Service } from '../types'
import { SERVICES, SERVICE_NAMES } from './clients'
import type { Client, ProjectEntry, Roster } from './clients'

export type TableView = { title: string; note?: string; columns: string[]; rows: string[][] }
export type Table = { title: string; description: string; views: TableView[] }

const NONE = '—'

/** Where the table file lives, under the person's home folder. */
export function tablePath(home: string): string {
  return `${home.replace(/[\\/]+$/, '')}/.claude/client-switch/skill-hub-table.json`
}

/** The roster's three tables. */
export function accountTable(roster: Roster): Table {
  const projects = namedProjects(roster)
  return {
    title: '帳號對照',
    description: '由 client-switch 依 ~/.claude/clients.json 產生。要修改請跟 Claude 說，Claude 改名冊後這裡會自動更新。',
    views: [byProject(projects), byClient(roster, projects), byService(roster, projects)],
  }
}

type Named = { name: string; entry: ProjectEntry; uses: Map<Service, string> }

/** Each listed project with a short name and the services it uses: service → whose account. */
function namedProjects(roster: Roster): Named[] {
  const entries = Object.entries(roster.projects)
  const prefix = commonFolder(entries.map(([path]) => path.replace(/\\/g, '/')))
  return entries.map(([path, entry]) => {
    const uses = new Map<Service, string>()
    for (const service of SERVICES) {
      const owner = entry.accounts?.[service] ?? (linksOf(entry, service).length > 0 ? entry.client : undefined)
      if (owner !== undefined) {
        uses.set(service, owner)
      }
    }
    return { name: path.replace(/\\/g, '/').slice(prefix.length) || path, entry, uses }
  })
}

function byProject(projects: Named[]): TableView {
  return {
    title: '依專案',
    note: '只列名冊裡的專案，其他專案依 git remote 判斷客戶。「—」是名冊沒記這個專案用到這項服務。',
    columns: ['專案', '客戶', ...SERVICES.map(service => SERVICE_NAMES[service]), '部署'],
    rows: projects.map(({ name, entry, uses }) => [
      name,
      entry.client,
      ...SERVICES.map(service => {
        const owner = uses.get(service)
        const links = linksOf(entry, service)
        return owner === undefined ? NONE : links.length > 0 ? `${owner}：${links.join('、')}` : owner
      }),
      entry.deploy ?? NONE,
    ]),
  }
}

function byClient(roster: Roster, projects: Named[]): TableView {
  return {
    title: '依客戶',
    note: '括號裡是用到這個客戶帳號、但屬於別的客戶的專案，以及用到的服務。',
    columns: ['客戶', ...SERVICES.map(service => SERVICE_NAMES[service]), '專案'],
    rows: Object.entries(roster.clients).map(([name, client]) => [
      name,
      ...SERVICES.map(service => accountOf(client, service) ?? NONE),
      projects
        .flatMap(({ name: project, entry, uses }) => {
          if (entry.client === name) {
            return [project]
          }
          const borrowed = SERVICES.filter(service => uses.get(service) === name).map(service => SERVICE_NAMES[service])
          return borrowed.length > 0 ? [`${project}（屬於${entry.client}；${borrowed.join('、')}）`] : []
        })
        .join('、') || NONE,
    ]),
  }
}

function byService(roster: Roster, projects: Named[]): TableView {
  const rows: string[][] = []
  for (const service of SERVICES) {
    for (const [owner, client] of Object.entries(roster.clients)) {
      for (const { name, entry, uses } of projects) {
        if (uses.get(service) === owner) {
          const account = accountOf(client, service)
          rows.push([
            SERVICE_NAMES[service],
            account === undefined ? owner : `${owner}：${account}`,
            name,
            linksOf(entry, service).join('、') || NONE,
          ])
        }
      }
    }
  }
  return { title: '依服務', note: '同一個服務底下，每個專案用誰的帳號。', columns: ['服務', '帳號', '專案', '在服務上的名稱'], rows }
}

/** A client's account on a service, in a few words, or undefined when the roster has none. */
function accountOf(client: Client, service: Service): string | undefined {
  switch (service) {
    case 'github': {
      const github = client.github
      const who = github?.user ?? github?.owners?.join('、')
      return who === undefined ? undefined : github?.email === undefined ? who : `${who}（${github.email}）`
    }
    case 'vercel':
      return client.vercel?.team
    case 'supabase':
      return client.supabase?.projects?.join('、') || undefined
    case 'cloudflare':
      return client.cloudflare?.accounts?.join('、') || undefined
    case 'google':
      return client.google?.email
  }
}

/** The project's links for a service: the `github` link, and `vercel-site`, `vercel-backend`, ... */
function linksOf(entry: ProjectEntry, service: Service): string[] {
  return Object.entries(entry.links ?? {})
    .filter(([key]) => key === service || key.startsWith(`${service}-`))
    .map(([, value]) => value)
}

/** The folder every path is under, with its trailing slash; '' when they share none. */
function commonFolder(paths: string[]): string {
  if (paths.length === 0) {
    return ''
  }
  const parts = paths.map(path => path.split('/'))
  const shared: string[] = []
  // the last segment is the project itself, never part of the shared folder
  for (let i = 0; i < Math.min(...parts.map(p => p.length - 1)); i++) {
    const segment = parts[0]?.[i]
    if (segment === undefined || !parts.every(p => p[i]?.toLowerCase() === segment.toLowerCase())) {
      break
    }
    shared.push(segment)
  }
  return shared.length === 0 ? '' : `${shared.join('/')}/`
}
