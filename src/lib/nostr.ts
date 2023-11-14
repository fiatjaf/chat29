import {
  relayInit,
  utils,
  type EventTemplate,
  type Relay,
  type Event
} from 'nostr-tools'
import {readable} from 'svelte/store'

export type Metadata = {
  pubkey: string
  name?: string
  display_name?: string
  nip05?: string
  nip05valid: boolean
  picture?: string
}

const _conn: Record<string, Relay> = {}
const _metadataCache = new Map<string, Metadata>()

export const signer = {
  getPublicKey: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pubkey = await (window as any).nostr.getPublicKey()
    setAccount(await getMetadata(pubkey))
    return pubkey
  },
  signEvent: async (event: EventTemplate): Promise<Event> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const se: Event = await (window as any).nostr.signEvent(event)
    setAccount(await getMetadata(se.pubkey))
    return se
  }
}

let setAccount: (_: Metadata) => void
export const account = readable<Metadata | null>(null, set => {
  setAccount = (account: Metadata) => {
    localStorage.setItem('loggedin', JSON.stringify(account))
    set(account)
  }

  // try to load account from localStorage on startup
  const data = localStorage.getItem('loggedin')
  try {
    set(JSON.parse(data || ''))
  } catch (err) {
    /***/
  }
})

export const profiles = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://purplepag.es'
]

export async function ensureRelay(url: string): Promise<Relay> {
  const nm = utils.normalizeURL(url)

  if (!_conn[nm]) {
    _conn[nm] = relayInit(nm, {
      getTimeout: 3000,
      listTimeout: 5000
    })
  }

  const relay = _conn[nm]
  await relay.connect()
  return relay
}

export async function publish(
  unsignedEvent: EventTemplate,
  relays: string[]
): Promise<{
  event?: Event
  successes: string[]
  failures: string[]
  error?: string
}> {
  const successes: string[] = []
  const failures: string[] = []
  let error: string | undefined

  let event: Event
  try {
    event = await signer.signEvent(unsignedEvent)
  } catch (err) {
    error = String(err)
    return {event: undefined, successes, failures, error}
  }

  await Promise.all(
    relays.map(async url => {
      try {
        const r = await ensureRelay(url)
        await r.publish(event)
        successes.push(url)
      } catch (err) {
        console.warn('failed to publish', event, 'to', url, err)
        failures.push(url)
        error = String(err)
      }
    })
  )

  return {event, successes, failures, error}
}

export async function getMetadata(pubkey: string): Promise<Metadata> {
  let metadata = _metadataCache.get(pubkey)
  if (metadata) return metadata

  // TODO: use dexie as a second-level cache

  metadata = await new Promise<Metadata>(resolve => {
    let ongoing = profiles.length
    profiles.forEach(async url => {
      const r = await ensureRelay(url)
      const event = await r.get({kinds: [0], authors: [pubkey]})
      if (event) {
        try {
          const metadata = JSON.parse(event.content)
          metadata.pubkey = pubkey
          resolve(metadata)
        } catch (err) {
          ongoing--
          if (ongoing === 0) {
            resolve({pubkey, nip05valid: false})
          }
        }
      }
    })
  })

  // TODO: validate nip05

  _metadataCache.set(pubkey, metadata)
  return metadata
}
