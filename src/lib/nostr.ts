import {
  setNostrWasm,
  type EventTemplate,
  type Event,
  type VerifiedEvent,
  verifyEvent
} from 'nostr-tools/wasm'
import {AbstractSimplePool} from 'nostr-tools/abstract-pool'
import type {AbstractRelay, Subscription} from 'nostr-tools/abstract-relay'
import {normalizeURL} from 'nostr-tools/utils'
import {initNostrWasm} from 'nostr-wasm'
import {init as initNostrLogin, logout as nostrLoginLogout} from 'nostr-login'
import {readable} from 'svelte/store'
import {parseGroup, parseMembers, type Group} from 'nostr-tools/nip29'

// a group plus the member pubkeys the relay reported for it: Buzz names
// every DM channel "DM", so the participants are the only way to tell
// them apart in a list
export type ChatGroup = Group & {participants?: string[]}

export type Metadata = {
  pubkey: string
  groups: ChatGroup[]
  writeRelays: string[]
  lastGroupsList?: Event
  name?: string
  display_name?: string
  nip05?: string
  nip05valid: boolean
  picture?: string
  // every picture URL seen across profile versions, newest first — the
  // UI falls back to the next one when an image fails to load
  pictures?: string[]
}

initNostrWasm().then(setNostrWasm)

// nostr-login only shows its dialog after it has looked up the NIP-05
// service info of the remote signers it offers (nsec.app and friends).
// On a network where such a provider is unreachable that fetch hangs for
// the browser's full connect timeout and the login dialog never appears,
// so bound those lookups — a missing provider entry is harmless.
if (typeof window !== 'undefined' && typeof AbortSignal.timeout === 'function') {
  const originalFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    if (url.includes('/.well-known/nostr.json') && !init?.signal) {
      return originalFetch(input, {...init, signal: AbortSignal.timeout(3000)})
    }
    return originalFetch(input, init)
  }
}

// nostr-login provides window.nostr for users without an extension:
// remote signers (nip46), a locally stored key or read-only mode all
// end up behind the same interface, so nothing below needs to know
// which one the user picked
initNostrLogin({
  theme: 'default',
  // asking up front keeps remote signers from prompting mid-conversation:
  // 9/10 chat, 7 reactions, 5 + 9005 delete, 9021 join, 9001/9006
  // moderation, 10009 group list, 22242 relay auth, 24242 media
  // authorization
  perms: [
    'sign_event:0',
    'sign_event:5',
    'sign_event:7',
    'sign_event:9',
    'sign_event:10',
    'sign_event:9001',
    'sign_event:9005',
    'sign_event:9006',
    'sign_event:9021',
    'sign_event:10009',
    'sign_event:22242',
    'sign_event:24242'
  ].join(',')
}).catch((err: unknown) => {
  console.warn('failed to initialize nostr-login', err)
})

// the user can log out (or switch accounts) from nostr-login's own UI
document.addEventListener('nlAuth', ((e: CustomEvent) => {
  const detail = e.detail
  if (detail?.type === 'logout') {
    removeAccount()
  } else if (detail?.pubkey) {
    initializeAccount(detail.pubkey)
  } else {
    // login/signup without a pubkey in the payload: ask the signer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).nostr
      ?.getPublicKey()
      .then((pubkey: string) => initializeAccount(pubkey))
      .catch((err: unknown) => console.warn('failed to read pubkey', err))
  }
}) as EventListener)

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
    // also drops nostr-login's session (nip46 connection, stored key)
    try {
      nostrLoginLogout()
    } catch (err) {
      console.warn('failed to log out of nostr-login', err)
    }
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
  'wss://purplepag.es',
  'wss://yabu.me',
  'wss://relay.nostr.wirednet.jp'
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
): Promise<Event> {
  const event = await signer.signEvent(unsignedEvent)
  const relays = Array.isArray(relay) ? relay : [relay]
  const results = await Promise.allSettled(
    relays.map(async url => {
      const r = await pool.ensureRelay(url)
      await r.publish(event)
    })
  )
  // succeed if at least one relay accepted the event
  if (!results.some(res => res.status === 'fulfilled')) {
    const first = results[0] as PromiseRejectedResult | undefined
    throw first ? first.reason : new Error('no relays to publish to')
  }
  return event
}

// profiles are fetched from `relays` when given — in a NIP-29 chat that
// must be the group's own relay only, because spraying member pubkeys
// across public relays leaks who is in the group
export async function getMetadata(
  pubkey: string,
  relays?: string[]
): Promise<Metadata> {
  const sources = relays && relays.length ? relays : profileRelays
  const cacheKey = `${sources.join(',')}|${pubkey}`
  const cached = _metadataCache.get(cacheKey)
  if (cached) return cached

  const fetch = pool
    .querySync(sources, {kinds: [0], authors: [pubkey]})
    .catch(() => [] as Event[])
    .then(events => {
      // relays can hold different versions of the profile — a private
      // team relay may have a newer one with a display name but no
      // picture. merge field-wise: for each field the newest non-empty
      // value wins, so a partial profile doesn't erase the rest
      events.sort((a, b) => b.created_at - a.created_at)
      const merged: Record<string, unknown> = {}
      const pictures: string[] = []
      for (const event of events) {
        try {
          const content = JSON.parse(event.content)
          for (const [k, v] of Object.entries(content)) {
            if (v === '' || v === null || v === undefined) continue
            if (k === 'picture' && typeof v === 'string' && !pictures.includes(v)) {
              pictures.push(v)
            }
            if (!(k in merged)) merged[k] = v
          }
        } catch (err) {
          /* broken profile content, try the next one */
        }
      }
      return {
        pubkey,
        nip05valid: false,
        groups: [],
        writeRelays: [],
        ...merged,
        pictures
      } as Metadata
    })
  _metadataCache.set(cacheKey, fetch)
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

const _relayAuths = new Map<string, Promise<string>>()

// sign a NIP-42 AUTH for this relay exactly once, no matter how many
// subscriptions hit auth-required at the same time (e.g. the chat and the
// sidebar group list on a deep link) — concurrent AUTHs race on the same
// challenge and the loser fails permanently
export function authRelay(relay: AbstractRelay): Promise<string> {
  // keyed by challenge, not just url: a reconnected websocket brings a
  // fresh challenge and needs a fresh AUTH — a cached resolved promise
  // from the old connection would leave the new one unauthenticated
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const key = `${relay.url}|${(relay as any).challenge ?? ''}`
  let p = _relayAuths.get(key)
  if (!p) {
    p = relay.auth(evt => signer.signEvent(evt) as Promise<VerifiedEvent>)
    p.catch(() => {
      // a failed attempt must not poison future retries
      _relayAuths.delete(key)
    })
    _relayAuths.set(key, p)
  }
  return p
}

// like nostr-tools' subscribeRelayGroups, but handles NIP-42 auth-required
// relays (e.g. private team relays) by authenticating with the user's
// signer and retrying, doesn't depend on a CORS-enabled NIP-11 endpoint,
// and also reports each group's member list (kind 39002) so callers can
// show membership state
export function subscribeRelayGroupsWithAuth(
  url: string,
  callbacks: {
    ongroups: (groups: Group[], memberships: Record<string, string[]>) => void
    onerror: (err: Error) => void
  }
): () => void {
  let closed = false
  let sub: Subscription | undefined
  let authAttempts = 0
  let closeRetries = 0

  const fail = (err: unknown) => {
    if (closed) return
    callbacks.onerror(err instanceof Error ? err : new Error(String(err)))
  }

  let membersSub: Subscription | undefined

  const start = async () => {
    try {
      const relay = await pool.ensureRelay(normalizeURL(url))
      if (closed) return
      const groups: Group[] = []
      const memberships: Record<string, string[]> = {}
      let groupsEosed = false
      const emit = () => {
        if (groupsEosed) callbacks.ongroups([...groups], {...memberships})
      }
      const handleGroup = (event: Event) => {
        const g = parseGroup(event, relay.url)
        // replaceable events may arrive again with updates
        const idx = groups.findIndex(x => x.id === g.id)
        if (idx === -1) groups.push(g)
        else groups[idx] = g
      }
      const handleMembers = (event: Event) => {
        const d = event.tags.find(t => t[0] === 'd')?.[1]
        if (d) memberships[d] = parseMembers(event).map(m => m.pubkey)
      }

      // member lists are strictly best-effort decoration: they only start
      // after the groups subscription succeeded, on their own subscription,
      // so a relay that dislikes this query can never take down the list
      const startMembers = () => {
        if (closed) return
        if (membersSub) membersSub.close()
        try {
          membersSub = relay.subscribe([{kinds: [39002], limit: 100}], {
            onevent(event) {
              handleMembers(event)
              emit()
            },
            oneose: emit,
            onclose() {
              /* membership display is best-effort */
            }
          })
        } catch (err) {
          console.warn('failed to subscribe to member lists', err)
        }
      }

      sub = relay.subscribe([{kinds: [39000], limit: 50}], {
        onevent: handleGroup,
        oneose() {
          groupsEosed = true
          closeRetries = 0
          emit()
          sub!.onevent = event => {
            handleGroup(event)
            emit()
          }
          startMembers()
        },
        onclose(reason) {
          if (closed) return
          if (
            !reason.includes('auth-required') &&
            !reason.includes('restricted')
          ) {
            // dropped idle websocket or a relay that closes subscriptions
            // on its own — resubscribe with backoff so the list stays live
            if (closeRetries < 6) {
              closeRetries++
              setTimeout(
                () => {
                  if (!closed) start()
                },
                Math.min(2000 * closeRetries, 15000)
              )
            }
            return
          }
          if (reason.includes('auth-required') && authAttempts < 3) {
            authAttempts++
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (!(window as any).nostr) {
              fail(
                new Error(
                  'this relay requires authentication — please log in first'
                )
              )
              return
            }
            // the relay may still be registering our AUTH when the retry
            // arrives, so back off a little more on each attempt
            authRelay(relay)
              .then(
                () => new Promise(r => setTimeout(r, 300 * authAttempts))
              )
              .then(() => start())
              .catch(fail)
          } else if (
            reason.includes('auth-required') ||
            reason.includes('restricted')
          ) {
            fail(new Error(reason))
          }
        }
      })
    } catch (err) {
      fail(err)
    }
  }
  start()

  return () => {
    closed = true
    if (sub) sub.close()
    if (membersSub) membersSub.close()
  }
}

// read a group's kind:39000 metadata, authenticating when the relay asks
// for it — private team relays reject an anonymous read, which used to
// leave the sidebar showing the raw group id instead of its name
export function fetchGroupMetadata(
  url: string,
  id: string,
  timeoutMs = 8000
): Promise<ChatGroup | null> {
  return new Promise(resolve => {
    let settled = false
    let authAttempted = false
    const finish = (group: ChatGroup | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(group)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)

    // a closed subscription still runs nostr-tools' eose timer, which would
    // otherwise answer "no metadata" while the auth retry is in flight
    let attempt = 0

    pool
      .ensureRelay(normalizeURL(url))
      .then(relay => {
        const start = () => {
          if (settled) return
          const mine = ++attempt
          const stale = () => settled || mine !== attempt
          let found: ChatGroup | null = null
          let participants: string[] = []
          const sub = relay.subscribe(
            [
              {kinds: [39000], '#d': [id]},
              // Buzz surfaces DMs as groups that are all named "DM"; the
              // member list is the only thing telling them apart
              {kinds: [39002], '#d': [id]}
            ],
            {
            onevent(event) {
              if (stale()) return
              if (event.kind === 39002) {
                participants = parseMembers(event).map(m => m.pubkey)
                if (found) found.participants = participants
                return
              }
              found = parseGroup(event, relay.url)
              if (participants.length) found.participants = participants
            },
            oneose() {
              if (stale()) return
              sub.close()
              finish(found)
            },
            onclose(reason) {
              if (stale()) return
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const canAuth = !!(window as any).nostr
              if (reason.includes('auth-required') && !authAttempted && canAuth) {
                authAttempted = true
                attempt++ // retire this attempt's pending callbacks
                authRelay(relay)
                  .then(start)
                  .catch(() => finish(null))
                return
              }
              finish(found)
            }
            }
          )
        }
        start()
      })
      .catch(() => finish(null))
  })
}

export function subscribeGroups(
  relays: string[],
  pubkey: string,
  lastGroupsList: Event | undefined,
  onGroupsUpdated: (_: ChatGroup[], __: Event) => void
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
      groupsList.tags.map(async (tag): Promise<ChatGroup | null> => {
        if (tag[0] !== 'group' || tag.length < 3) return null

        // if the group's relay can't be reached right now we still keep the
        // group in the list, otherwise it would silently vanish. the name is
        // left unset rather than filled with the id so a later lookup (or
        // the UI's own fallback) can still show a real name
        const fallback: ChatGroup = {
          id: tag[1],
          relay: tag[2],
          pubkey: ''
        }
        try {
          const group = await fetchGroupMetadata(tag[2], tag[1])
          return group ?? fallback
        } catch (err) {
          return fallback
        }
      })
    ).then((groups: (ChatGroup | null)[]) => {
      // a newer groups list started processing while we were fetching
      if (thisGeneration !== generation) return
      onGroupsUpdated(groups.filter(Boolean) as ChatGroup[], groupsList)
    })
  }

  return () => {
    // discard any in-flight processGroupsList results as well
    generation++
    sub.close()
  }
}
