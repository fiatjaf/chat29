import {describe, expect, it, vi, beforeEach, afterEach} from 'vitest'
import {get} from 'svelte/store'

import {humanDate, showToast, toastState} from './utils.ts'

describe('humanDate', () => {
  it('shows a relative time for recent events', () => {
    const tenMinutesAgo = Math.round(Date.now() / 1000) - 600
    expect(humanDate(tenMinutesAgo)).toMatch(/ago/)
  })

  it('shows an absolute date for events older than 60 hours', () => {
    const longAgo = Math.round(new Date('2024-03-05T10:00:00Z').getTime() / 1000)
    // "Mar 05 2024", without the weekday
    expect(humanDate(longAgo)).toMatch(/^[A-Z][a-z]{2} \d{2} \d{4}$/)
  })
})

describe('showToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    toastState.set(null)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a toast and clears it when its time is up', () => {
    showToast({type: 'normal', text: 'first'}, 1000)
    expect(get(toastState)?.text).toBe('first')

    vi.advanceTimersByTime(1000)
    expect(get(toastState)).toBe(null)
  })

  it('gives a queued toast its own display time', () => {
    showToast({type: 'normal', text: 'first'}, 1000)
    showToast({type: 'error', text: 'second'}, 1000)

    vi.advanceTimersByTime(999)
    expect(get(toastState)?.text).toBe('first')

    vi.advanceTimersByTime(1)
    expect(get(toastState)?.text).toBe('second')

    // the queued toast used to be replaced within the same tick
    vi.advanceTimersByTime(999)
    expect(get(toastState)?.text).toBe('second')

    vi.advanceTimersByTime(1)
    expect(get(toastState)).toBe(null)
  })
})
