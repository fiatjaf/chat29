import {authedMediaUrl, canSignMediaAuth} from './blossom.ts'

// Images in message bodies are plain <img> tags produced by the markdown
// renderer. Relays that gate media behind Blossom authorization answer
// those requests with 401, and a browser cannot attach the header to an
// <img src>. This action watches for such failures and re-fetches the
// bytes with authorization, handing the element a blob: URL instead.
export type MediaParams = {
  // re-rendered body, only used so the action's update() fires
  body: string
  // host of the relay this chat is on; authorization is minted for it
  // alone, so a broken third-party image can never trigger a signature
  host: string
}

export function enhanceMedia(node: HTMLElement, params: MediaParams) {
  // images whose inline view needed authorization: their full-size view
  // needs it as well, so the anchor click has to be intercepted
  const authed = new WeakSet<HTMLImageElement>()

  function isRelayMedia(url: string): boolean {
    if (!params.host) return false
    try {
      return new URL(url, location.href).host === params.host
    } catch (err) {
      return false
    }
  }

  async function loadAuthed(img: HTMLImageElement) {
    const src = img.dataset.src
    if (!src || img.dataset.mediaState) return
    if (!isRelayMedia(src)) {
      img.dataset.mediaState = 'external'
      return
    }
    if (!canSignMediaAuth()) {
      img.dataset.mediaState = 'unavailable'
      return
    }
    img.dataset.mediaState = 'loading'
    try {
      img.src = await authedMediaUrl(src)
      img.dataset.mediaState = 'authed'
      authed.add(img)
    } catch (err) {
      console.warn('failed to load media', src, err)
      img.dataset.mediaState = 'failed'
      // leave the broken image; the surrounding link still works
    }
  }

  function onError(ev: Event) {
    const img = ev.target
    if (img instanceof HTMLImageElement && img.dataset.src) loadAuthed(img)
  }

  async function onClick(ev: MouseEvent) {
    const target = ev.target
    if (!(target instanceof HTMLImageElement)) return
    if (!authed.has(target)) return
    const anchor = target.closest('a')
    const full = anchor?.getAttribute('href')
    if (!full) return
    // a new tab cannot send the authorization header either, so resolve
    // the full-size blob here and open that
    ev.preventDefault()
    try {
      window.open(await authedMediaUrl(full), '_blank', 'noopener')
    } catch (err) {
      console.warn('failed to open media', full, err)
    }
  }

  // the error event does not bubble, so it has to be captured
  node.addEventListener('error', onError, true)
  node.addEventListener('click', onClick)

  function scan() {
    for (const img of node.querySelectorAll('img[data-src]')) {
      if (!(img instanceof HTMLImageElement)) continue
      // an element whose src is left to this action (so a re-render can't
      // reset an authorized blob: URL back to the bare, 401-ing one)
      if (!img.getAttribute('src')) {
        img.src = img.dataset.src as string
        continue
      }
      // an image that already failed before this action ran (or was
      // restored from cache as broken) never fires another error event
      if (img.complete && img.naturalWidth === 0) {
        loadAuthed(img)
      }
    }
  }
  scan()

  return {
    update(next: MediaParams) {
      params = next
      // the body was re-rendered: new <img> elements need the same check
      scan()
    },
    destroy() {
      node.removeEventListener('error', onError, true)
      node.removeEventListener('click', onClick)
    }
  }
}
