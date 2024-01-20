import {
  setNostrWasm,
  type EventTemplate,
  type Event,
  verifyEvent
} from 'nostr-tools/wasm'
import {AbstractSimplePool} from 'nostr-tools/abstract-pool'
import {initNostrWasm} from 'nostr-wasm'
import {readable} from 'svelte/store'
import {parseGroup, type Group} from 'nostr-tools/nip29'

export type Metadata = {
  pubkey: string
  groups: Group[]
  writeRelays: string[]
  lastGroupsList?: Event
  name?: string
  display_name?: string
  nip05?: string
  nip05valid: boolean
  picture?: string
}

initNostrWasm().then(setNostrWasm)

export const pool = new AbstractSimplePool({verifyEvent})

const _metadataCache = new Map<string, Promise<Metadata>>()

export const signer = {
  getPublicKey: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pubkey = await (window as any).nostr.getPublicKey()
    initializeAccount(pubkey)
    return pubkey
  },
  signEvent: async (event: EventTemplate): Promise<Event> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const se: Event = await (window as any).nostr.signEvent(event)
    initializeAccount(se.pubkey)
    return se
  },
  signOut: (): void => {
    removeAccount()
  }
}

let removeAccount: () => void
let initializeAccount: (pubkey: string) => Promise<void>
export const account = readable<Metadata | null>(null, set => {
  let isInitialized = false

  removeAccount = () => {
    isInitialized = false
    localStorage.removeItem('loggedin')
    set(null)
  }

  initializeAccount = async (pubkey: string) => {
    if (isInitialized) return
    isInitialized = true

    const account = await getMetadata(pubkey)

    localStorage.setItem('loggedin', JSON.stringify(account))
    set(account)

    account.writeRelays =
      (await getWriteRelays(account.pubkey)) ?? defaultRelays
    set(account)

    subscribeGroups(
      account.writeRelays,
      account.pubkey,
      account.lastGroupsList,
      (groups, lastGroupsList) => {
        account.groups = groups
        account.lastGroupsList = lastGroupsList
        localStorage.setItem('loggedin', JSON.stringify(account))
        set(account)
      }
    )
  }

  // try to load account from localStorage on startup
  const data = localStorage.getItem('loggedin')
  try {
    const account: Metadata = JSON.parse(data || '')
    if (!account.groups) account.groups = []
    set(account)
  } catch (err) {
    /***/
  }
})

export const profileRelays = [
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
  'wss://purplepag.es'
]

export const relayListRelays = [
  'wss://purplepag.es',
  'wss://nos.lol',
  'wss://nostr-pub.wellorder.net',
  'wss://relay.damus.io'
]

export const defaultRelays = [
  'wss://public.relaying.io',
  'wss://relay.nostr.bg',
  'wss://nostr21.com'
]

export async function publish(
  unsignedEvent: EventTemplate,
  relay: string | string[]
): Promise<void> {
  const event = await signer.signEvent(unsignedEvent)
  if (Array.isArray(relay)) {
    relay.forEach(async url => {
      const r = await pool.ensureRelay(url)
      await r.publish(event)
    })
  } else {
    const r = await pool.ensureRelay(relay)
    await r.publish(event)
  }
}

export async function getMetadata(pubkey: string): Promise<Metadata> {
  const cached = _metadataCache.get(pubkey)
  if (cached) return cached

  const fetch = pool
    .get(profileRelays, {kinds: [0], authors: [pubkey]})
    .catch(() => ({content: '{}'}))
    .then(event => ({
      pubkey,
      nip05valid: false,
      groups: [],
      writeRelays: [],
      ...JSON.parse(event!.content)
    }))
  _metadataCache.set(pubkey, fetch)
  return fetch
}

export async function getWriteRelays(
  pubkey: string
): Promise<string[] | undefined> {
  try {
    const event = await pool.get(relayListRelays, {
      kinds: [10002],
      authors: [pubkey]
    })
    if (!event) return undefined
    const list = []
    for (let i = 0; i < event.tags.length; i++) {
      const tag = event.tags[i]
      if (
        tag[0] === 'r' &&
        typeof tag[1] === 'string' &&
        (!tag[2] || tag[2] === 'write')
      ) {
        list.push(tag[1])
      }
    }
    return list.length ? list : undefined
  } catch (err) {
    return undefined
  }
}

export async function subscribeGroups(
  relays: string[],
  pubkey: string,
  lastGroupsList: Event | undefined,
  onGroupsUpdated: (_: Group[], __: Event) => void
): Promise<void> {
  if (lastGroupsList) processGroupsList(lastGroupsList)
  pool.subscribeMany(
    relays,
    [
      {
        kinds: [10009],
        authors: [pubkey]
      }
    ],
    {
      onevent(event) {
        if (!lastGroupsList || event.created_at > lastGroupsList.created_at) {
          lastGroupsList = event
          processGroupsList(event)
        }
      }
    }
  )

  function processGroupsList(groupsList: Event) {
    Promise.all(
      groupsList.tags.map(async tag => {
        try {
          if (tag[0] === 'group' && tag.length >= 3) {
            return pool
              .get([tag[2]], {kinds: [39000], '#d': [tag[1]]})
              .then(gevent => {
                if (gevent) {
                  const group = parseGroup(gevent)
                  group.relay = tag[2]
                  return group
                }
                return null
              })
          }
        } catch (err) {
          /***/
        }
        return null
      })
    ).then((groups: (Group | null)[]) =>
      onGroupsUpdated(
        groups.filter(Boolean) as Group[],
        lastGroupsList as Event
      )
    )
  }
}
