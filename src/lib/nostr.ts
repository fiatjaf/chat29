import type {EventTemplate, Event} from 'nostr-tools/pure'
import {readable} from 'svelte/store'
import {SimplePool} from 'nostr-tools/pool'

export type Metadata = {
  pubkey: string
  name?: string
  display_name?: string
  nip05?: string
  nip05valid: boolean
  picture?: string
}

export const pool = new SimplePool()

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

export const profileRelays = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://purplepag.es'
]

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
        const r = await pool.ensureRelay(url)
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
  const cached = _metadataCache.get(pubkey)
  if (cached) return cached

  // TODO: use dexie as a second-level cache

  let metadata = {pubkey, nip05valid: false}
  try {
    const event = await pool.get(profileRelays, {kinds: [0], authors: [pubkey]})
    metadata = {...JSON.parse(event!.content), ...metadata}
  } catch (err) {
    /***/
  }
  return metadata
}
