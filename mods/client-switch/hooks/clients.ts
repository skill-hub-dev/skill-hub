// client-switch: block 1, the client roster and which client a project belongs to (2026-10-30).
// The roster is ~/.claude/clients.json, kept outside every repo. It holds
// names, account names and ids, never a password or token:
//
//   {
//     "clients": {
//       "甲公司": {
//         "github": { "owners": ["example"], "user": "example", "email": "..." },
//         "vercel": { "team": "my-team" },
//         "supabase": { "projects": ["abcd1234"] },
//         "cloudflare": { "accounts": ["0123abcd..."] },
//         "google": { "email": "..." }
//       }
//     },
//     "projects": {
//       "C:/work/my-shop": { "client": "甲公司", "links": { "vercel": "my-shop" } },
//       "C:/work/radar-app": {
//         "client": "丙商行",
//         "accounts": { "github": "乙工作室", "cloudflare": "乙工作室" },
//         "deploy": "Cloudflare Workers radar-app"
//       }
//     }
//   }
//
// A project the projects list names is that client's, each service under
// the client its accounts name, or the project's own client. Any other falls
// back to its git remote: github.com/<owner>/... belongs to the client whose
// github.owners lists that owner. Nothing matching leaves it unassigned.
// Pure: register.tsx reads the file and runs git.

import type { ClientMatch, Service } from '../types'

export const SERVICES: readonly Service[] = ['github', 'vercel', 'supabase', 'cloudflare', 'google']

export const SERVICE_NAMES: Record<Service, string> = {
  github: 'GitHub',
  vercel: 'Vercel',
  supabase: 'Supabase',
  cloudflare: 'Cloudflare',
  google: 'Google',
}

export type Client = {
  github?: { owners?: string[]; user?: string; email?: string; name?: string }
  vercel?: { team?: string }
  supabase?: { projects?: string[] }
  /** Cloudflare account ids, as wrangler names them. */
  cloudflare?: { accounts?: string[] }
  google?: { email?: string }
}

export type ProjectEntry = {
  client: string
  /**
   * The services this project runs under another client's account, by
   * service: that client. A repo kept for the client under the agency's
   * GitHub, say. The rest use `client`'s accounts.
   */
  accounts?: Partial<Record<Service, string>>
  /** How this project ships, in a sentence. */
  deploy?: string
  /** What else this project is tied to, by service: a Vercel project, a Supabase project ref, ... */
  links?: Record<string, string>
}

export type Roster = {
  /** In the order the file lists them. */
  clients: Record<string, Client>
  projects: Record<string, ProjectEntry>
  /** The Skill Hub folder whose dashboard shows the roster's tables; none, no tables. */
  skillHub?: string
}

/** Where the roster lives, under the person's home folder. */
export function rosterPath(home: string): string {
  return `${home.replace(/[\\/]+$/, '')}/.claude/clients.json`
}

/** The roster, or why it cannot be read, in Traditional Chinese. */
export function parseRoster(text: string): { roster: Roster } | { error: string } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { error: '不是有效的 JSON' }
  }
  if (!isObject(data) || !isObject(data.clients)) {
    return { error: '缺少 "clients"' }
  }

  const clients: Record<string, Client> = {}
  for (const [name, client] of Object.entries(data.clients)) {
    if (!isObject(client)) {
      return { error: `客戶「${name}」的設定不是物件` }
    }
    const owners = isObject(client.github) ? client.github.owners : undefined
    if (owners !== undefined && !(Array.isArray(owners) && owners.every(owner => typeof owner === 'string'))) {
      return { error: `客戶「${name}」的 github.owners 要是字串陣列` }
    }
    clients[name] = client as Client
  }

  const projects: Record<string, ProjectEntry> = {}
  if (data.projects !== undefined) {
    if (!isObject(data.projects)) {
      return { error: '"projects" 不是物件' }
    }
    for (const [path, entry] of Object.entries(data.projects)) {
      if (!isObject(entry) || typeof entry.client !== 'string') {
        return { error: `專案 ${path} 少了 "client"` }
      }
      if (!(entry.client in clients)) {
        return { error: `專案 ${path} 指到不存在的客戶「${entry.client}」` }
      }
      if ('gitAs' in entry) {
        return { error: `專案 ${path} 的 gitAs 已改成 accounts.github` }
      }
      if (entry.accounts !== undefined) {
        if (!isObject(entry.accounts)) {
          return { error: `專案 ${path} 的 accounts 不是物件` }
        }
        for (const [service, owner] of Object.entries(entry.accounts)) {
          if (!(SERVICES as readonly string[]).includes(service)) {
            return { error: `專案 ${path} 的 accounts 有不認得的服務「${service}」` }
          }
          if (!(typeof owner === 'string' && owner in clients)) {
            return { error: `專案 ${path} 的 accounts.${service} 指到不存在的客戶「${String(owner)}」` }
          }
        }
      }
      if (entry.deploy !== undefined && typeof entry.deploy !== 'string') {
        return { error: `專案 ${path} 的 deploy 要是文字` }
      }
      projects[path] = entry as ProjectEntry
    }
  }

  if (data.skillHub !== undefined && typeof data.skillHub !== 'string') {
    return { error: '"skillHub" 要是資料夾路徑' }
  }

  return data.skillHub === undefined ? { roster: { clients, projects } } : { roster: { clients, projects, skillHub: data.skillHub } }
}

/** A folder path in one spelling: forward slashes, no trailing slash, lower case (Windows paths ignore case). */
export function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * The GitHub owner a remote URL points at, lower case, or undefined for a
 * remote elsewhere. Takes https (with or without a user), scp-style ssh, and
 * ssh:// URLs, and ssh host aliases such as github.com-acme.
 */
export function remoteOwner(url: string): string | undefined {
  const match =
    /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?(github\.com[^/:]*)(?::\d+)?\/([^/]+)\//i.exec(url.trim()) ??
    /^(?:[^@/]+@)?(github\.com[^/:]*):\/?([^/]+)\//i.exec(url.trim())
  return match?.[2]?.toLowerCase()
}

/** Which client the project at `root` belongs to; `remoteUrl` is its origin, when it has one. */
export function matchClient(roster: Roster, root: string, remoteUrl?: string): ClientMatch {
  const folder = normalizePath(root)
  let best: { key: string; entry: ProjectEntry } | undefined
  for (const [path, entry] of Object.entries(roster.projects)) {
    const key = normalizePath(path)
    const isInside = folder === key || folder.startsWith(`${key}/`)
    if (isInside && (!best || key.length > best.key.length)) {
      best = { key, entry }
    }
  }
  if (best) {
    const { client, accounts = {} } = best.entry
    const others: Partial<Record<Service, string>> = {}
    for (const service of SERVICES) {
      const owner = accounts[service]
      if (owner !== undefined && owner !== client) {
        others[service] = owner
      }
    }
    return Object.keys(others).length === 0
      ? { kind: 'client', name: client, source: 'project' }
      : { kind: 'client', name: client, source: 'project', accounts: others }
  }

  const owner = remoteUrl === undefined ? undefined : remoteOwner(remoteUrl)
  if (owner !== undefined) {
    for (const [name, client] of Object.entries(roster.clients)) {
      if (client.github?.owners?.some(listed => listed.toLowerCase() === owner)) {
        return { kind: 'client', name, source: 'remote' }
      }
    }
  }

  return { kind: 'none', reason: 'no-match' }
}

/** The band's line for a match: its text and whether it is a warning. */
export function bandLine(match: ClientMatch): { text: string; note?: string; isWarning: boolean } {
  switch (match.kind) {
    case 'client':
      return { text: `客戶：${match.name}`, note: clientNote(match), isWarning: false }
    case 'none':
      return {
        text: '客戶：未指定',
        note: match.reason === 'no-roster' ? '（還沒建 ~/.claude/clients.json）' : '（名冊裡沒有這個專案）',
        isWarning: true,
      }
    case 'error':
      return { text: `clients.json 有誤：${match.reason}`, isWarning: true }
  }
}

/** How a client was decided, and which services use another client's account, grouped by that client. */
function clientNote(match: Extract<ClientMatch, { kind: 'client' }>): string {
  if (match.source === 'remote') {
    return '（依 git remote 判斷）'
  }
  const byOwner = new Map<string, string[]>()
  for (const service of SERVICES) {
    const owner = match.accounts?.[service]
    if (owner !== undefined) {
      byOwner.set(owner, [...(byOwner.get(owner) ?? []), SERVICE_NAMES[service]])
    }
  }
  if (byOwner.size === 0) {
    return '（專案設定）'
  }
  const borrowed = [...byOwner].map(([owner, names]) => `${names.join('、')} 用${owner}的帳號`)
  return `（專案設定；${borrowed.join('；')}）`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
