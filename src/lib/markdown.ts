import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

// message bodies are markdown, matching what other NIP-29 clients (Buzz)
// publish and render: GFM-ish with hard line breaks, since chat messages
// are written with the enter key rather than blank lines
const md = new MarkdownIt({
  html: false, // never trust raw HTML from a relay
  linkify: true, // bare URLs become links
  breaks: true, // a single newline is a line break
  typographer: false
})

export type ImageMeta = {
  url: string
  alt?: string
  dim?: string // "<width>x<height>", used to reserve space before load
  thumb?: string // relay-generated thumbnail, cheaper for the inline view
}

// NIP-92 "imeta" tags carry optional metadata about the media referenced
// in the body; nothing depends on them, they only improve rendering
export function parseImetaTags(tags: string[][]): Map<string, ImageMeta> {
  const map = new Map<string, ImageMeta>()
  for (const tag of tags) {
    if (tag[0] !== 'imeta') continue
    const entry: Partial<ImageMeta> = {}
    for (const part of tag.slice(1)) {
      const sp = part.indexOf(' ')
      if (sp === -1) continue
      const key = part.slice(0, sp)
      const val = part.slice(sp + 1)
      if (key === 'url') entry.url = val
      else if (key === 'alt') entry.alt = val
      else if (key === 'dim') entry.dim = val
      else if (key === 'thumb') entry.thumb = val
    }
    if (entry.url) map.set(entry.url, entry as ImageMeta)
  }
  return map
}

const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

md.renderer.rules.image = (tokens, idx, _options, env) => {
  const token = tokens[idx]
  const src = String(token.attrGet('src') || '')
  const meta: ImageMeta | undefined = (
    env as {imeta?: Map<string, ImageMeta>} | undefined
  )?.imeta?.get(src)
  const alt = String(token.content || meta?.alt || '')
  // reserving the aspect ratio keeps messages from jumping around while
  // images load, the same reason Buzz stores "dim" in imeta
  let style = ''
  const dim = meta?.dim?.match(/^(\d+)x(\d+)$/)
  if (dim) style = ` style="aspect-ratio:${dim[1]}/${dim[2]}"`
  // prefer the relay's thumbnail for the inline view; the full blob is
  // only fetched when the image is opened
  const display = String(meta?.thumb || src)
  const escapedSrc = md.utils.escapeHtml(src)
  const escapedDisplay = md.utils.escapeHtml(display)
  const escapedAlt = md.utils.escapeHtml(alt)
  return (
    `<a href="${escapedSrc}" target="_blank" rel="noopener noreferrer" class="md-image-link">` +
    `<img src="${escapedDisplay}" data-src="${escapedDisplay}" alt="${escapedAlt}" loading="lazy"${style}>` +
    `</a>`
  )
}

let purifierReady = false
function ensurePurifier() {
  if (purifierReady) return
  purifierReady = true
  // links are rendered with target=_blank above; make sure nothing can
  // strip the rel that protects the opener
  DOMPurify.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'em', 'strong', 's', 'del', 'blockquote',
  'ul', 'ol', 'li', 'code', 'pre', 'a', 'img',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td'
]

const ALLOWED_ATTR = [
  'href', 'title', 'target', 'rel',
  'src', 'alt', 'loading', 'style', 'class'
]

// render a message body to sanitized HTML
export function renderMarkdown(
  content: string,
  imeta?: Map<string, ImageMeta>
): string {
  ensurePurifier()
  const html = md.render(content, {imeta})
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // data: and blob: URLs in messages are more likely abuse than content
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|nostr:|#)/i,
    // the regexp above is also applied to attributes that aren't URIs
    // unless they are declared safe, which would drop these two
    ADD_URI_SAFE_ATTR: ['target', 'loading']
  })
}
