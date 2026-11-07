// client-switch: the values this mod keeps in $.state.

/** A service a client has an account with, as the roster spells it. */
export type Service = 'github' | 'vercel' | 'supabase' | 'cloudflare' | 'google'

/** Which client this session's project belongs to, and how that was decided. */
export type ClientMatch =
  | {
      kind: 'client'
      /** The client's name as the roster spells it. */
      name: string
      /** `project`: the roster's projects list names this folder; `remote`: the git remote's owner is one of the client's. */
      source: 'project' | 'remote'
      /** The services this project runs under another client's account, by service: that client. The rest use `name`'s. */
      accounts?: Partial<Record<Service, string>>
    }
  | {
      kind: 'none'
      /** `no-roster`: ~/.claude/clients.json is not there yet; `no-match`: nothing in it names this project. */
      reason: 'no-roster' | 'no-match'
    }
  | {
      kind: 'error'
      /** Why clients.json could not be read, in Traditional Chinese. */
      reason: string
    }

declare module 'claude-code' {
  interface PluginState {
    'client-switch': {
      match: ClientMatch | null
    }
  }
}
