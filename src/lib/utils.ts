import {writable} from 'svelte/store'
import ago from 's-ago'

export function humanDate(created_at: number): string {
  const d = created_at * 1000
  if (d < Date.now() - 1000 * 60 * 60 * 60 /* 60 hours */)
    return new Date(d).toDateString().split(' ').slice(1).join(' ')
  return ago(new Date(d))
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
    setTimeout(onToastEnd)
  } else {
    toastState.set(null)
  }
}

type ToastState = {
  text: string
  type: 'normal' | 'error' | 'success'
}
