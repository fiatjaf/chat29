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
  toastState.set(state)
  setTimeout(() => {
    toastState.set(null)
  }, timeout)
}

type ToastState = {
  text: string
  type: 'normal' | 'error' | 'success'
}
