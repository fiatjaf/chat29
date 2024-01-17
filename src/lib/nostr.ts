import {
  setNostrWasm,
  type EventTemplate,
  type Event,
  verifyEvent
} from 'nostr-tools/wasm'
import {readable} from 'svelte/store'
import {AbstractSimplePool} from 'nostr-tools/abstract-pool'
import {initNostrWasm} from 'nostr-wasm'

export type Metadata = {
  pubkey: string
  name?: string
  display_name?: string
  nip05?: string
  nip05valid: boolean
  picture?: string
}

initNostrWasm().then(setNostrWasm)

export const pool = new AbstractSimplePool({verifyEvent})

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
  relay: string
): Promise<void> {
  const event = await signer.signEvent(unsignedEvent)
  const r = await pool.ensureRelay(relay)
  await r.publish(event)
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
