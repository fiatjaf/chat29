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
let initializeAccount: (pubkey: string, stored?: Metadata) => Promise<void>
export const account = readable<Metadata | null>(null, set => {
  let isInitialized = false
  let currentPubkey: string | undefined
  let session = 0
  let closeGroupsSub: (() => void) | undefined

  removeAccount = () => {
    // invalidate pending async work from the old session so it can't
    // write to localStorage or the store after logout
    session++
    isInitialized = false
    currentPubkey = undefined
    if (closeGroupsSub) {
      closeGroupsSub()
      closeGroupsSub = undefined
    }
    localStorage.removeItem('loggedin')
    set(null)
  }

  initializeAccount = async (pubkey: string, stored?: Metadata) => {
    if (isInitialized) {
      if (pubkey === currentPubkey) return
      // the signer switched to a different account
      removeAccount()
    }
    isInitialized = true
    currentPubkey = pubkey
    const thisSession = ++session

    const account = stored || (await getMetadata(pubkey))
    if (thisSession !== session) return
    if (!account.groups) account.groups = []

    localStorage.setItem('loggedin', JSON.stringify(account))
    set(account)

    const writeRelays = await getWriteRelays(account.pubkey)
    if (thisSession !== session) return
    account.writeRelays = writeRelays ?? defaultRelays
    set(account)

    if (closeGroupsSub) closeGroupsSub()
    closeGroupsSub = subscribeGroups(
      account.writeRelays,
      account.pubkey,
      account.lastGroupsList,
      (groups, lastGroupsList) => {
        if (thisSession !== session) return
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
    const stored: Metadata = JSON.parse(data || '')
    if (!stored.groups) stored.groups = []
    set(stored)
    // resume the session: refresh relays and watch for group list updates
    initializeAccount(stored.pubkey, stored)
  } catch (err) {
    /***/
  }

  return () => {
    if (closeGroupsSub) {
      closeGroupsSub()
      closeGroupsSub = undefined
    }
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
    .catch(() => null)
    .then(event => {
      if (event) {
        try {
          return {
            pubkey,
            nip05valid: false,
            groups: [],
            writeRelays: [],
            ...JSON.parse(event.content)
          }
        } catch (err) {
          /* broken profile content, use the fallback below */
        }
      }
      return {pubkey, nip05valid: false, groups: [], writeRelays: []}
    })
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

export function subscribeGroups(
  relays: string[],
  pubkey: string,
  lastGroupsList: Event | undefined,
  onGroupsUpdated: (_: Group[], __: Event) => void
): () => void {
  let generation = 0

  if (lastGroupsList) processGroupsList(lastGroupsList)
  const sub = pool.subscribeMany(
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
    const thisGeneration = ++generation
    Promise.all(
      groupsList.tags.map(async (tag): Promise<Group | null> => {
        if (tag[0] !== 'group' || tag.length < 3) return null

        // if the group's relay can't be reached right now we still keep the
        // group in the list, otherwise it would silently vanish
        const fallback: Group = {
          id: tag[1],
          relay: tag[2],
          pubkey: '',
          name: tag[1]
        }
        try {
          const gevent = await pool.get([tag[2]], {
            kinds: [39000],
            '#d': [tag[1]]
          })
          return gevent ? parseGroup(gevent, tag[2]) : fallback
        } catch (err) {
          return fallback
        }
      })
    ).then((groups: (Group | null)[]) => {
      // a newer groups list started processing while we were fetching
      if (thisGeneration !== generation) return
      onGroupsUpdated(groups.filter(Boolean) as Group[], groupsList)
    })
  }

  return () => {
    // discard any in-flight processGroupsList results as well
    generation++
    sub.close()
  }
}
