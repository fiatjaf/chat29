import {signer} from './nostr.ts'

// Relays may require Blossom (BUD-01/BUD-11) authorization to read media,
// which browsers cannot attach to a plain <img src>. Fetching the bytes
// with the header and handing the <img> a blob: URL is the browser-side
// equivalent of the localhost proxy the Buzz desktop app uses.

// Ten minutes, the same lifetime Buzz uses: long enough that a message
// full of images needs a single signature, short enough to stay well
// inside the relay's freshness window.
const AUTH_TTL_SECS = 600

type CachedAuth = {header: string; expires: number}

const authByHost = new Map<string, Promise<CachedAuth>>()
const blobByUrl = new Map<string, Promise<string>>()

function base64url(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function mintAuth(host: string): Promise<CachedAuth> {
  const now = Math.round(Date.now() / 1000)
  const expiration = now + AUTH_TTL_SECS
  // server-scoped (a "server" tag and no "x" tag) so one signature covers
  // every blob on this host; the relay still checks membership for the
  // signing pubkey, and the header only ever goes to that same host
  const event = await signer.signEvent({
    kind: 24242,
    content: 'Get media',
    created_at: now,
    tags: [
      ['t', 'get'],
      ['expiration', String(expiration)],
      ['server', host]
    ]
  })
  return {
    header: 'Nostr ' + base64url(JSON.stringify(event)),
    expires: expiration
  }
}

async function authHeaderFor(host: string): Promise<string> {
  const pending = authByHost.get(host)
  if (pending) {
    try {
      const cached = await pending
      // renew slightly early so a request can't race the expiry
      if (cached.expires - 30 > Math.round(Date.now() / 1000)) {
        return cached.header
      }
    } catch (err) {
      /* fall through and mint a new one */
    }
  }
  const fresh = mintAuth(host)
  authByHost.set(host, fresh)
  fresh.catch(() => {
    if (authByHost.get(host) === fresh) authByHost.delete(host)
  })
  return (await fresh).header
}

// fetch media that needs authorization and return a blob: URL for it
export function authedMediaUrl(url: string): Promise<string> {
  const cached = blobByUrl.get(url)
  if (cached) return cached

  const loading = (async () => {
    const host = new URL(url).host
    const res = await fetch(url, {
      headers: {Authorization: await authHeaderFor(host)}
    })
    if (!res.ok) throw new Error(`media ${res.status}`)
    return URL.createObjectURL(await res.blob())
  })()

  blobByUrl.set(url, loading)
  loading.catch(() => {
    if (blobByUrl.get(url) === loading) blobByUrl.delete(url)
  })
  return loading
}

export function canSignMediaAuth(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof (window as any).nostr !== 'undefined'
}
