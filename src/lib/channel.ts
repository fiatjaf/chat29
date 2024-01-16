import type {Event} from 'nostr-tools/pure'

export type Channel = {
  id: string
  name: string
  picture: string
  about: string
  relay: string
  public: boolean
  open: boolean
}

export function parseChannel(event: Event): Channel {
  const chan: Partial<Channel> = {}
  for (let i = 0; i < event.tags.length; i++) {
    const tag = event.tags[i]
    switch (tag[0]) {
      case 'd':
        chan.id = tag[1] || ''
        break
      case 'name':
        chan.name = tag[1] || ''
        break
      case 'about':
        chan.about = tag[1] || ''
        break
      case 'picture':
        chan.picture = tag[1] || ''
        break
      case 'open':
        chan.open = true
        break
      case 'public':
        chan.public = true
        break
    }
  }
  return chan as Channel
}
