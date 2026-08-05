import {writable} from 'svelte/store'
import ago from 's-ago'

export function humanDate(created_at: number): string {
  const d = created_at * 1000
  if (d < Date.now() - 1000 * 60 * 60 * 60 /* 60 hours */)
    return new Date(d).toDateString().split(' ').slice(1).join(' ')
  return ago(new Date(d))
}

export type MessageSegment = {
  type: 'text' | 'code'
  content: string
  lang?: string
}

// split a message into plain-text and ```fenced code``` segments; unclosed
// fences stay plain text. rendering keeps using svelte text interpolation,
// so nothing here needs escaping
export function splitCodeBlocks(src: string): MessageSegment[] {
  const segments: MessageSegment[] = []
  const re = /```([^\n`]*)\n([\s\S]*?)\n?```/g

  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    let text = src.slice(last, m.index)
    // drop the newline separating text from the fence, the block spacing
    // already provides it visually
    text = text.replace(/\n$/, '')
    if (last > 0) text = text.replace(/^\n/, '')
    if (text !== '') segments.push({type: 'text', content: text})

    segments.push({type: 'code', content: m[2], lang: m[1].trim() || undefined})
    last = re.lastIndex
  }

  let rest = src.slice(last)
  if (last > 0) rest = rest.replace(/^\n/, '')
  if (rest !== '') segments.push({type: 'text', content: rest})

  return segments
}

export const toastState = writable<ToastState | null>(null)

export function showToast(state: ToastState, timeout: number = 4000) {
  toastState.update(curr => {
    if (curr === null) {
      setTimeout(onToastEnd, timeout)
      return state
    } else {
      nextToasts.push({state, timeout})
      return curr
    }
  })
}

const nextToasts: {state: ToastState; timeout: number}[] = []

function onToastEnd() {
  const next = nextToasts.shift()
  if (next) {
    toastState.set(next.state)
    setTimeout(onToastEnd, next.timeout)
  } else {
    toastState.set(null)
  }
}

type ToastState = {
  text: string
  type: 'normal' | 'error' | 'success'
}
