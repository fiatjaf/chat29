<script lang="ts" context="module">
  import type {Event as CachedEvent} from 'nostr-tools/wasm'

  // per-group message cache so switching between groups shows the last
  // known messages instantly while the subscription refetches in the
  // background; module-scoped so it survives page component re-creation
  const messageCache = new Map<string, CachedEvent[]>()
</script>

<script lang="ts">
  import {afterUpdate, onMount} from 'svelte'
  import {debounce} from 'debounce'
  import type {Event, VerifiedEvent} from 'nostr-tools/wasm'
  import {normalizeURL} from 'nostr-tools/utils'
  import type {AbstractRelay, Subscription} from 'nostr-tools/abstract-relay'
  import {
    parseGroup,
    parseMembers,
    type Group,
    type Member
  } from 'nostr-tools/nip29'

  import {account} from '../lib/nostr.ts'
  import {
    pool,
    publish,
    authRelay,
    profileRelays,
    subscribeRelayGroupsWithAuth
  } from '../lib/nostr.ts'
  import {showToast, humanDate} from '../lib/utils.ts'
  import {renderMarkdown, parseImetaTags} from '../lib/markdown.ts'
  import {enhanceMedia} from '../lib/mediaAction.ts'
  import UserLabel from '../components/UserLabel.svelte'
  import Header from '../components/Header.svelte'
  import MemberLabel from '../components/MemberLabel.svelte'
  import GroupsList from '../components/GroupsList.svelte'

  export let host: string
  export let id: string

  let messages: Event[] = []
  // NIP-25 kind-7 reaction events, keyed by the reacted message's id
  let reactions: Record<string, Event[]> = {}
  // reactions from other clients (Buzz) only carry the "e" tag of the
  // message they belong to — no NIP-29 "h" tag — so they have to be
  // subscribed by message id rather than by group
  let reactionSub: Subscription | undefined
  let reactionIdsKey = ''
  let text = localStorage.getItem('text') || ''
  let isSending = false
  let group: Group | null = null
  let admins: Member[] = []
  let members: Member[] = []
  let info: {pubkey: string; name: string; description: string; icon: string}
  let relay: AbstractRelay
  let sub: Subscription
  let liveSub: Subscription | undefined
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let eoseHappened = false
  let relayChannels: Group[] = []
  let relayMemberships: Record<string, string[]> = {}
  let relayChannelsHost = ''
  let cancelRelayChannels: (() => void) | undefined

  // newest message created_at per group on this relay, and the newest
  // created_at the user has seen per group — the sidebar shows an
  // unread dot when activity is newer than the last read position
  let groupActivity: Record<string, number> = {}
  let lastReads: Record<string, number> = {}
  let activitySub: Subscription | undefined
  let activityIdsKey = ''

  // profiles of chat participants are looked up on this relay first-hand,
  // plus the public profile relays for users who only publish kind 0 there
  $: chatRelays = relay ? [relay.url, ...profileRelays] : []
  // media hosted by the chat relay itself may need Blossom auth
  $: mediaHost = relay ? new URL(relay.url).host : ''
  $: isMember = !!members.find(m => m.pubkey === $account?.pubkey)
  $: isAdmin = !!admins.find(m => m.pubkey === $account?.pubkey)

  // while a group switch reloads `group`/`members`, fall back to the
  // relay-wide lists (kept across switches on the same relay) so the
  // sidebar's "add this group to list?" button doesn't blink out and
  // shift the sections below it
  $: sidebarGroup = group ?? relayChannels.find(c => c.id === id) ?? null
  $: sidebarIsMember =
    !!$account &&
    (isMember || !!relayMemberships[id]?.includes($account.pubkey))

  const updateMessages = debounce(() => {
    // stored events can arrive after eose fired: nostr-tools gives up
    // waiting for EOSE after 4.4s and a slow relay answers the REQ later,
    // so events landing here are not necessarily in chronological order
    messages.sort((a, b) => a.created_at - b.created_at)
    messages = messages
    scrollToEnd()
    markRead()
    refreshReactions()
  }, 300)

  const saveToLocalStorage = debounce(() => {
    localStorage.setItem('text', text)
  }, 2000)

  function scrollToEnd() {
    if (messages.length > 3) {
      setTimeout(() => {
        document
          .getElementById(`evt-${messages[messages.length - 1].id.slice(-6)}`)
          ?.scrollIntoView()
      }, 25)
    }
  }

  function cacheCurrentMessages() {
    if (current && messages.length) {
      messageCache.set(`${current.host}|${current.id}`, messages)
    }
  }

  function lastReadKey(h: string, groupId: string): string {
    return `lastRead:${h}'${groupId}`
  }

  function markRead() {
    if (!current || !messages.length) return
    const t = messages[messages.length - 1].created_at
    if ((lastReads[current.id] || 0) >= t) return
    lastReads[current.id] = t
    lastReads = lastReads
    localStorage.setItem(lastReadKey(current.host, current.id), String(t))
  }

  function noteActivity(event: Event) {
    const h = event.tags.find(t => t[0] === 'h')?.[1]
    if (!h) return
    if ((groupActivity[h] || 0) < event.created_at) {
      groupActivity[h] = event.created_at
      groupActivity = groupActivity
    }
  }

  // one lightweight subscription covering every public group of the
  // relay keeps the sidebar's unread dots fresh; re-created only when
  // the set of groups actually changes
  function ensureActivitySub(ids: string[]) {
    const key = ids.slice().sort().join(',')
    if (key === activityIdsKey && activitySub) return
    activityIdsKey = key
    if (activitySub) {
      activitySub.close()
      activitySub = undefined
    }
    if (!ids.length || !relay) return

    for (const groupId of ids) {
      if (!(groupId in lastReads)) {
        const stored = localStorage.getItem(lastReadKey(relayChannelsHost, groupId))
        if (stored) lastReads[groupId] = Number(stored)
      }
    }
    lastReads = lastReads

    // initial snapshot: the newest events across all groups tell us
    // which ones have activity beyond the stored read positions
    pool
      .querySync([relay.url], {kinds: [9, 10, 11, 12], '#h': ids, limit: 100})
      .then(events => {
        for (const e of events) noteActivity(e)
      })
      .catch(err => {
        console.warn('failed to load group activity', err)
      })

    activitySub = relay.subscribe(
      [
        {
          kinds: [9, 10, 11, 12],
          '#h': ids,
          since: Math.round(Date.now() / 1000) - 10
        }
      ],
      {
        onevent: noteActivity,
        onclose() {
          /* unread dots are best-effort */
        }
      }
    )
  }

  onMount(() => {
    return () => {
      cacheCurrentMessages()
      unloadChat()
      if (cancelRelayChannels) cancelRelayChannels()
      if (activitySub) activitySub.close()
    }
  })

  let current: {host: string; id: string} | null
  let authAttempted = false
  // generation guard: closing a subscription on purpose (navigation,
  // auth retry) must not be mistaken for a dropped connection
  let chatGeneration = 0
  let reconnectAttempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  afterUpdate(() => {
    if (current && current.host === host && current.id === id) return
    cacheCurrentMessages()
    current = {host, id}
    reconnectAttempts = 0
    unloadChat()
    loadChat()
  })

  function unloadChat() {
    chatGeneration++
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = undefined
    }
    if (liveSub) {
      liveSub.close()
      liveSub = undefined
    }
    if (reactionSub) {
      reactionSub.close()
      reactionSub = undefined
    }
    reactionIdsKey = ''
    if (sub) sub.close()
    eoseHappened = false
    messages = []
    reactions = {}
    group = null
    admins = []
    members = []
  }

  // (re)subscribe to the reactions of the messages currently loaded. the
  // subscription stays open so live reactions arrive as well; it is only
  // rebuilt when the set of messages actually changed
  const refreshReactions = debounce(() => {
    if (!relay || !messages.length) return
    // newest messages first: those are the ones on screen, and a relay
    // that caps tag values will keep the most useful ones
    const ids = messages.slice(-500).map(m => m.id)
    const key = `${ids.length}:${ids[0]}:${ids[ids.length - 1]}`
    if (key === reactionIdsKey && reactionSub) return
    reactionIdsKey = key

    const chunks: string[][] = []
    for (let i = 0; i < ids.length; i += 250) chunks.push(ids.slice(i, i + 250))

    const previous = reactionSub
    try {
      reactionSub = relay.subscribe(
        chunks.map(chunk => ({kinds: [7], '#e': chunk})),
        {
          onevent(event) {
            if (addReactionEvent(event)) reactions = reactions
          },
          oneose() {
            reactions = reactions
          },
          onclose() {
            /* reactions are decoration; the next refresh retries */
          }
        }
      )
    } catch (err) {
      console.warn('failed to subscribe to reactions', err)
      reactionIdsKey = ''
    }
    if (previous) previous.close()
  }, 500)

  function pushMessage(event: Event): boolean {
    if (messages.some(m => m.id === event.id)) return false
    messages.push(event)
    return true
  }

  // per NIP-25 the reacted event is the last "e" tag
  function reactionTarget(event: Event): string | undefined {
    for (let i = event.tags.length - 1; i >= 0; i--) {
      const tag = event.tags[i]
      if (
        tag[0] === 'e' &&
        typeof tag[1] === 'string' &&
        tag[1].length === 64
      ) {
        return tag[1]
      }
    }
    return undefined
  }

  function addReactionEvent(event: Event): boolean {
    const target = reactionTarget(event)
    if (!target) return false
    const list = reactions[target] || []
    if (list.some(r => r.id === event.id)) return false
    reactions[target] = [...list, event]
    reactions = reactions
    return true
  }

  function removeReactionsLocally(ids: string[]) {
    let changed = false
    for (const key of Object.keys(reactions)) {
      // the reacted message was deleted: drop its reactions wholesale
      if (ids.includes(key)) {
        delete reactions[key]
        changed = true
        continue
      }
      // a reaction itself was deleted (un-react)
      const filtered = reactions[key].filter(r => !ids.includes(r.id))
      if (filtered.length !== reactions[key].length) {
        if (filtered.length) reactions[key] = filtered
        else delete reactions[key]
        changed = true
      }
    }
    if (changed) reactions = reactions
  }

  type ReactionChip = {
    key: string
    text?: string
    url?: string
    count: number
    mine: Event | null
    sample: Event
  }

  // how a single kind-7 content is displayed: '+'/'' mean like, '-'
  // dislike, and ':shortcode:' is a NIP-30 custom emoji whose image URL
  // sits in the event's own 'emoji' tag
  function reactionDisplay(r: Event): {key: string; text?: string; url?: string} {
    const c = r.content.trim()
    if (c === '+' || c === '') return {key: '+', text: '👍'}
    if (c === '-') return {key: '-', text: '👎'}
    const m = c.match(/^:([a-zA-Z0-9_+-]+):$/)
    if (m) {
      const url = r.tags.find(t => t[0] === 'emoji' && t[1] === m[1])?.[2]
      if (url) return {key: c, url}
    }
    return {key: c, text: c}
  }

  function aggregateReactions(list: Event[] | undefined): ReactionChip[] {
    if (!list || !list.length) return []
    const chips = new Map<string, ReactionChip & {pubkeys: string[]}>()
    for (const r of list) {
      const d = reactionDisplay(r)
      let chip = chips.get(d.key)
      if (!chip) {
        chip = {...d, count: 0, mine: null, sample: r, pubkeys: []}
        chips.set(d.key, chip)
      }
      // count each user once per emoji even if a relay kept several
      if (!chip.pubkeys.includes(r.pubkey)) {
        chip.pubkeys.push(r.pubkey)
        chip.count++
      }
      if (r.pubkey === $account?.pubkey) chip.mine = r
    }
    return [...chips.values()]
  }

  // a chat message is a reply when it references another event via a
  // "q" (quote) tag or a non-mention "e" tag
  function replyRefOf(message: Event): string | undefined {
    const tag = message.tags.find(
      t =>
        (t[0] === 'q' || (t[0] === 'e' && t[3] !== 'mention')) &&
        typeof t[1] === 'string' &&
        t[1].length === 64
    )
    return tag?.[1]
  }

  function scrollToMessage(id: string) {
    document
      .getElementById(`evt-${id.slice(-6)}`)
      ?.scrollIntoView({behavior: 'smooth', block: 'center'})
  }

  // safety net for relays that never stream live events over an open
  // subscription: periodically fetch anything newer than what we have
  async function pollRecent() {
    if (!current || !relay) return
    try {
      const last = messages.length
        ? messages[messages.length - 1].created_at
        : Math.round(Date.now() / 1000)
      const recent = await pool.querySync([relay.url], {
        kinds: [9, 10, 11, 12],
        '#h': [current.id],
        since: last - 300,
        limit: 100
      })
      let added = 0
      for (const evt of recent) {
        if (pushMessage(evt)) added++
      }
      if (added) {
        // if this ever fires, the relay is not streaming live events to
        // our open subscription — keep the poller; if it stays quiet the
        // poller can be removed
        console.warn(`poller found ${added} message(s) the live stream missed`)
        messages.sort((a, b) => a.created_at - b.created_at)
        messages = messages
        scrollToEnd()
        markRead()
      }
    } catch (err) {
      console.warn('failed to poll recent messages', err)
    }
  }

  // proxies in front of relays (e.g. cloudflare) drop idle websockets,
  // and some relays close subscriptions on their own — without a
  // reconnect the chat silently stops receiving new events
  function scheduleReconnect(reason: string) {
    if (reconnectTimer) return
    const delay = Math.min(1000 * 2 ** reconnectAttempts, 15000)
    reconnectAttempts++
    console.warn(
      `chat subscription closed (${reason}) — reconnecting in ${delay}ms`
    )
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      unloadChat()
      loadChat()
    }, delay)
  }

  async function loadChat() {
    if (!current) return
    const gen = ++chatGeneration
    authAttempted = false

    // show the last known messages of this group instantly; the
    // subscription below refetches and reconciles in the background
    const cached = messageCache.get(`${current.host}|${current.id}`)
    if (cached && !messages.length) {
      messages = [...cached]
      scrollToEnd()
      markRead()
    }

    // ids seen from the current subscription, to weed out cached
    // messages that were deleted while we were not subscribed
    const freshIds = new Set<string>()
    let minFreshCreatedAt = Infinity

    try {
      relay = await pool.ensureRelay(current.host)

      // keep a list of the relay's public groups in the sidebar; only
      // resubscribe when we move to a different relay
      if (!cancelRelayChannels || relayChannelsHost !== current.host) {
        if (cancelRelayChannels) cancelRelayChannels()
        relayChannelsHost = current.host
        relayChannels = []
        relayMemberships = {}
        if (activitySub) {
          activitySub.close()
          activitySub = undefined
        }
        activityIdsKey = ''
        groupActivity = {}
        lastReads = {}
        cancelRelayChannels = subscribeRelayGroupsWithAuth(current.host, {
          ongroups(groups: Group[], m: Record<string, string[]>) {
            // a re-subscription racing with the relay's auth handling can
            // deliver an empty snapshot after a good one — never let that
            // blank out a list the user is already looking at
            if (groups.length || !relayChannels.length) relayChannels = groups
            if (Object.keys(m).length || !Object.keys(relayMemberships).length)
              relayMemberships = m
            ensureActivitySub(relayChannels.map(g => g.id))
          },
          onerror(err: Error) {
            console.warn('failed to load relay groups', err)
          }
        })
      }

      // NIP-11 information is nice to have, but plenty of relays don't
      // serve it (or lack CORS headers) — never let it block the chat
      fetch(normalizeURL(current.host).replace('ws', 'http'), {
        headers: {accept: 'application/nostr+json'}
      })
        .then(r => r.json())
        .then(nip11 => {
          info = nip11
        })
        .catch(err => {
          console.warn('failed to fetch relay information', err)
        })

      sub = relay.subscribe(
        [
          // 9 = chat message, 10 = chat reply, 11/12 = thread post/reply —
          // bots and other clients use the reply kinds too
          {kinds: [9, 10, 11, 12], '#h': [current.id], limit: 700},
          // reactions get their own filter so they don't eat into the
          // message limit above
          {kinds: [7], '#h': [current.id], limit: 700},
          {kinds: [39000, 39001, 39002], '#d': [current.id]},
          {
            kinds: [5, 9005],
            '#h': [current.id],
            limit: 0,
            since: Math.round(Date.now() / 1000)
          }
        ],
        {
          onevent(event) {
            if (!current) return

            switch (event.kind) {
              case 39000:
                group = parseGroup(event, current.host)
                group.relay = relay.url
                break
              case 39001:
                admins = parseMembers(event)
                break
              case 39002:
                members = parseMembers(event)
                break
              case 7:
                addReactionEvent(event)
                break
              case 9:
              case 10:
              case 11:
              case 12:
                freshIds.add(event.id)
                if (event.created_at < minFreshCreatedAt) {
                  minFreshCreatedAt = event.created_at
                }
                // the subscription can be restarted (e.g. after AUTH), so
                // the same stored events may arrive again
                if (pushMessage(event as any) && eoseHappened) {
                  updateMessages()
                }
                break
              case 9005:
              case 5: {
                const ids: string[] = []
                for (let i = 0; i < event.tags.length; i++) {
                  let tag = event.tags[i]
                  if (tag.length < 2 || tag[0] !== 'e') continue
                  ids.push(tag[1])
                  let idx = messages.findIndex(m => m.id === tag[1])
                  if (idx !== -1) {
                    messages.splice(idx, 1)
                  }
                }
                messages = messages
                // the deleted event may have been a reaction, or a message
                // that had reactions
                removeReactionsLocally(ids)
                break
              }
            }
          },
          oneose() {
            // drop cached messages the relay no longer returned inside the
            // refetched range: they were deleted while we were away (events
            // older than the fetch window are kept — the 700-limit query
            // simply doesn't reach them)
            if (freshIds.size) {
              messages = messages.filter(
                m => freshIds.has(m.id) || m.created_at < minFreshCreatedAt
              )
            }
            // relays are not required to return stored events in any
            // particular order, so sort instead of blindly reversing
            messages.sort((a, b) => a.created_at - b.created_at)
            messages = messages
            scrollToEnd()
            markRead()
            refreshReactions()
            eoseHappened = true
            if (gen === chatGeneration) reconnectAttempts = 0
          },
          onclose(reason) {
            // a close we caused ourselves (navigation, auth retry)
            if (gen !== chatGeneration) return
            console.warn(relay.url, 'relay connection closed', reason)
            if (reason.includes('auth-required') && !authAttempted) {
              authAttempted = true
              authRelay(relay)
                .then(() => {
                  unloadChat()
                  loadChat()
                })
                .catch((err: any) => {
                  console.warn('auth failed', err)
                  showToast({type: 'error', text: String(err)})
                })
            } else if (!reason.includes('restricted')) {
              scheduleReconnect(reason)
            }
          }
        }
      )

      // dedicated live stream: no limit, since ~now — some relays treat
      // limited REQs as one-shot queries and never stream events on them
      liveSub = relay.subscribe(
        [
          {
            kinds: [7, 9, 10, 11, 12],
            '#h': [current.id],
            since: Math.round(Date.now() / 1000) - 10
          }
        ],
        {
          onevent(event) {
            if (gen !== chatGeneration) return
            if (event.kind === 7) {
              addReactionEvent(event)
              return
            }
            freshIds.add(event.id)
            if (pushMessage(event as any)) updateMessages()
          },
          onclose() {
            /* the poller below covers us if this stream dies */
          }
        }
      )

      if (pollTimer) clearInterval(pollTimer)
      pollTimer = setInterval(pollRecent, 15000)
    } catch (err: any) {
      console.warn('failed to load chat', err)
      console.warn(err.stack)
      showToast({type: 'error', text: err?.message || String(err)})
    }
  }

  async function askToJoin() {
    try {
      isSending = true
      await publish(
        {
          kind: 9021,
          content: '',
          tags: [['h', group!.id]],
          created_at: Math.round(Date.now() / 1000)
        },
        relay.url
      )
      showToast({
        type: 'success',
        text: 'join request sent — open groups accept instantly, closed ones need admin approval'
      })
      isSending = false
    } catch (err: any) {
      console.warn('failed to ask to join', err)
      console.warn(err.stack)
      showToast({type: 'error', text: String(err)})
      isSending = false
    }
  }


  // NIP-29 anti-fork marker: reference the latest events we've seen so
  // the relay can verify we're on the same timeline — strict relays may
  // reject messages without it
  function previousTag(): string[][] {
    const ids = messages.slice(-3).map(m => m.id.slice(0, 8))
    return ids.length ? [['previous', ...ids]] : []
  }

  async function sendMessage() {
    if (isSending || !isMember || !group || !relay) return
    if (text.trim() === '') return
    try {
      isSending = true
      const sent = (await Promise.race([
        publish(
          {
            kind: 9,
            content: text,
            tags: [['h', group!.id], ...previousTag()],
            created_at: Math.round(Date.now() / 1000)
          },
          relay.url
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('send timed out')), 10000)
        )
      ])) as Event
      // show our own message right away — not every relay echoes events
      // back to the sender's own subscription (deduped by id if it does)
      if (!messages.some(m => m.id === sent.id)) {
        messages.push(sent)
        messages = messages
        scrollToEnd()
      }
      text = ''
      saveToLocalStorage()
      isSending = false
    } catch (err: any) {
      console.warn('failed to send', err)
      console.warn(err.stack)
      showToast({type: 'error', text: String(err)})
      isSending = false
    }
  }

  async function react(message: Event, content: string, extraTags: string[][] = []) {
    if (!isMember || !group || !relay) return
    try {
      const sent = await publish(
        {
          kind: 7,
          content,
          tags: [
            ['h', group.id],
            ['e', message.id],
            ['p', message.pubkey],
            ['k', String(message.kind)],
            ...extraTags,
            ...previousTag()
          ],
          created_at: Math.round(Date.now() / 1000)
        },
        relay.url
      )
      // show it right away — not every relay echoes events back
      addReactionEvent(sent)
    } catch (err: any) {
      console.warn('failed to react', err)
      showToast({type: 'error', text: String(err)})
    }
  }

  async function toggleReaction(message: Event, chip: ReactionChip) {
    if (!isMember || !group || !relay) return
    if (chip.mine) {
      // un-react: delete our own reaction event
      try {
        await publish(
          {
            kind: 5,
            content: '',
            tags: [
              ['h', group.id],
              ['e', chip.mine.id]
            ],
            created_at: Math.round(Date.now() / 1000)
          },
          relay.url
        )
        removeReactionsLocally([chip.mine.id])
      } catch (err: any) {
        console.warn('failed to remove reaction', err)
        showToast({type: 'error', text: String(err)})
      }
    } else {
      // custom emoji reactions need their 'emoji' tag re-attached so
      // other clients can resolve the shortcode to its image
      const emojiTags = chip.sample.tags.filter(t => t[0] === 'emoji')
      await react(message, chip.sample.content, emojiTags)
    }
  }

  async function deleteMessage(ev: MouseEvent) {
    const id = (ev.currentTarget as HTMLElement).dataset.id
    if (typeof id === 'string' && confirm('really delete this message?')) {
      try {
        await publish(
          {
            kind: isAdmin ? 9005 : 5,
            content: '',
            tags: [
              ['h', group!.id],
              ['e', id]
            ],
            created_at: Math.round(Date.now() / 1000)
          },
          relay.url
        )
        // reflect the deletion immediately — not every relay echoes the
        // deletion event back to the sender's own subscription
        const idx = messages.findIndex(m => m.id === id)
        if (idx !== -1) {
          messages.splice(idx, 1)
          messages = messages
        }
      } catch (err: any) {
        console.warn('failed to delete', err)
        console.warn(err.stack)
        showToast({type: 'error', text: String(err)})
      }
    }
  }

  // group status change (NIP-29 kind 9006): the relay applies the flag
  // tags and re-broadcasts the 39000 metadata, which updates `group`
  async function setGroupStatus(priv: boolean, closed: boolean) {
    if (!group) return
    try {
      isSending = true
      await publish(
        {
          kind: 9006,
          content: '',
          tags: [
            ['h', group.id],
            [priv ? 'private' : 'public'],
            [closed ? 'closed' : 'open']
          ],
          created_at: Math.round(Date.now() / 1000)
        },
        relay.url
      )
      showToast({type: 'success', text: 'group status updated'})
    } catch (err: any) {
      console.warn('failed to update group status', err)
      showToast({type: 'error', text: String(err)})
    } finally {
      isSending = false
    }
  }

  async function banMember(ev: CustomEvent) {
    const member: Member = ev.detail.member
    if (member && confirm('really ban this user?')) {
      try {
        await publish(
          {
            kind: 9001,
            content: '',
            tags: [
              ['h', group!.id],
              ['p', member.pubkey]
            ],
            created_at: Math.round(Date.now() / 1000)
          },
          relay.url
        )
        showToast({
          type: 'success',
          text: 'successfully banned ' + member.pubkey
        })
      } catch (err: any) {
        console.warn('failed to ban', err)
        console.warn(err.stack)
        showToast({type: 'error', text: String(err)})
      }
    }
  }

  function onKeyDown(ev: KeyboardEvent) {
    // plain Enter sends; Shift/Ctrl+Enter inserts a newline; Enter while
    // composing (IME) only confirms the conversion
    if (
      ev.key === 'Enter' &&
      !ev.shiftKey &&
      !ev.ctrlKey &&
      !ev.isComposing
    ) {
      ev.preventDefault()
      sendMessage()
    }
  }
</script>

<div class="flex h-screen flex-col overflow-hidden">
  <header
    class="shrink-0 border-b border-slate-200 bg-white/90 px-6 py-3 backdrop-blur"
  >
    <Header />
    <div class="mt-2 flex min-w-0 items-baseline justify-end gap-2">
      <span
        class="truncate text-lg font-semibold text-slate-900"
        title={id}
      >
        #{group?.name || id}
      </span>
      <span class="hidden text-xs text-slate-400 sm:inline">on {host}</span>
    </div>
  </header>

  <div class="flex min-h-0 flex-1">
    <aside
      class="hidden w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-4 md:block"
    >
      <GroupsList current={sidebarIsMember ? sidebarGroup : null} />

      {#if relayChannels.length}
        <div class="mt-6">
          <h3
            class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400"
          >
            groups on this relay
          </h3>
          {#each relayChannels as channel (channel.id)}
            {@const joined = !!(
              $account &&
              relayMemberships[channel.id]?.includes($account.pubkey)
            )}
            {@const unread =
              channel.id !== id &&
              (groupActivity[channel.id] || 0) > (lastReads[channel.id] || 0)}
            <div
              class="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors"
              class:bg-indigo-50={channel.id === id}
              class:text-indigo-700={channel.id === id}
              class:hover:bg-slate-100={channel.id !== id}
            >
              {#if channel.id === id}
                <span class="truncate font-medium" title={channel.id}
                  >#{channel.name || channel.id}</span
                >
              {:else}
                <a
                  class="cursor-pointer truncate hover:underline"
                  class:text-emerald-600={joined}
                  title={channel.id}
                  href={`/${host}'${channel.id}`}
                  >#{channel.name || channel.id}</a
                >
              {/if}
              {#if unread}
                <span
                  class="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500"
                  title="new messages"
                />
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </aside>

    <main class="flex min-w-0 flex-1 flex-col">
      <section class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
        {#if !eoseHappened && messages.length === 0}
          <div class="flex h-full items-center justify-center text-sm text-slate-400">
            loading messages…
          </div>
        {/if}
        {#each messages as message (message.id)}
          {@const replyId = replyRefOf(message)}
          {@const replyMsg = replyId
            ? messages.find(m => m.id === replyId)
            : undefined}
          {@const body = renderMarkdown(
            message.content,
            parseImetaTags(message.tags)
          )}
          {@const chips = aggregateReactions(reactions[message.id])}
          <!-- custom emoji live on the relay's blossom media endpoint too,
               so the chip row goes through the same authorized loader -->
          {@const chipsKey = chips.map(c => `${c.key}:${c.count}`).join(',')}
          <div
            class="group grid items-baseline gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-white"
            style:grid-template-columns="150px minmax(0, 1fr) auto"
            id={`evt-${message.id.slice(-6)}`}
          >
            <div class="min-w-0 self-start">
              <UserLabel pubkey={message.pubkey} relays={chatRelays} />
            </div>
            <div class="min-w-0 text-sm leading-relaxed text-slate-800">
              {#if replyId}
                <!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
                <div
                  class="mb-0.5 flex cursor-pointer items-center gap-1 text-xs text-slate-400 transition-colors hover:text-slate-600"
                  on:click={() => scrollToMessage(replyId)}
                  title="jump to the original message"
                >
                  <span class="shrink-0">↩</span>
                  <span class="truncate italic">
                    {replyMsg
                      ? replyMsg.content
                      : `${replyId.slice(0, 8)}…`}
                  </span>
                </div>
              {/if}
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <div class="markdown-body break-words" use:enhanceMedia={{body, host: mediaHost}}>
                {@html body}
              </div>
              {#if chips.length}
                <div
                  class="mt-1 flex flex-wrap gap-1"
                  use:enhanceMedia={{body: chipsKey, host: mediaHost}}
                >
                  {#each chips as chip (chip.key)}
                    <button
                      class="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors"
                      class:border-indigo-300={!!chip.mine}
                      class:bg-indigo-50={!!chip.mine}
                      class:text-indigo-700={!!chip.mine}
                      class:border-slate-200={!chip.mine}
                      class:bg-white={!chip.mine}
                      class:text-slate-600={!chip.mine}
                      class:hover:bg-slate-100={!chip.mine && isMember}
                      class:cursor-default={!isMember}
                      disabled={!isMember}
                      on:click={() => toggleReaction(message, chip)}
                      title={chip.mine
                        ? 'remove your reaction'
                        : isMember
                          ? 'react with the same emoji'
                          : `${chip.count} reaction(s)`}
                    >
                      {#if chip.url}
                        <!-- src is set by enhanceMedia, not by svelte: a
                             re-render (reacting, counts changing) would
                             otherwise reset an authorized blob: URL back
                             to the bare one and break the image -->
                        <img
                          class="h-4 w-4 object-contain"
                          data-src={chip.url}
                          alt={chip.key}
                        />
                      {:else}
                        <span>{chip.text}</span>
                      {/if}
                      <span>{chip.count}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
            <div
              class="flex items-center justify-end gap-1.5 text-xs text-slate-400"
            >
              {#if isMember}
                <button
                  class="cursor-pointer opacity-0 transition-opacity grayscale hover:grayscale-0 group-hover:opacity-100"
                  on:click={() => react(message, '+')}
                  title="react with 👍"
                >
                  👍
                </button>
                <button
                  class="cursor-pointer opacity-0 transition-opacity grayscale hover:grayscale-0 group-hover:opacity-100"
                  on:click={() => react(message, '❤️')}
                  title="react with ❤️"
                >
                  ❤️
                </button>
              {/if}
              {#if message.created_at > Date.now() / 1000 - 60 * 60 * 3 && (isAdmin || message.pubkey === $account?.pubkey)}
                <!-- svelte-ignore a11y-no-static-element-interactions a11y-missing-attribute -->
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <a
                  class="cursor-pointer opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                  on:click={deleteMessage}
                  data-id={message.id}
                  title="delete message"
                >
                  ×
                </a>
              {/if}
              <span title={new Date(message.created_at * 1000).toString()}>
                {humanDate(message.created_at)}
              </span>
            </div>
          </div>
        {/each}
      </section>

      <section class="shrink-0 border-t border-slate-200 bg-white p-4">
        {#if isMember}
          <form
            on:submit|preventDefault={sendMessage}
            class="flex items-stretch gap-3"
          >
            <textarea
              rows="2"
              class="min-h-[3rem] flex-1 resize-none rounded-xl border-slate-300 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              class:bg-slate-100={isSending}
              placeholder={isSending
                ? 'submitting...'
                : 'type a message here (press Enter to send)'}
              bind:value={text}
              on:input={saveToLocalStorage}
              on:keydown={onKeyDown}
              readonly={isSending}
            />
            <button
              class="shrink-0 rounded-xl px-6 font-medium text-white shadow-sm transition-colors"
              class:bg-indigo-600={!isSending}
              class:hover:bg-indigo-500={!isSending}
              class:bg-slate-400={isSending}
              disabled={isSending || !group?.id || !relay}
            >
              send
            </button>
          </form>
        {:else if group?.public && $account}
          <div class="flex justify-center py-2">
            <button
              class="rounded-xl bg-indigo-600 px-10 py-3 text-lg font-medium text-white shadow-md transition-colors hover:bg-indigo-500 disabled:bg-slate-400"
              on:click={askToJoin}
              disabled={isSending}>join this group</button
            >
          </div>
        {:else}
          <p
            class="rounded-xl bg-slate-100 p-4 text-center text-sm text-slate-500"
          >
            you are not a member of this group
          </p>
        {/if}
      </section>
    </main>

    <aside
      class="hidden w-60 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4 lg:block"
    >
      <h3
        class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400"
      >
        admins
      </h3>
      {#each admins as admin}
        <div class="py-0.5">
          <MemberLabel member={admin} relays={chatRelays} />
        </div>
      {/each}
      <h3
        class="mb-3 mt-6 text-xs font-semibold uppercase tracking-wider text-slate-400"
      >
        members
      </h3>
      {#each members as member}
        <div class="py-0.5">
          <MemberLabel
            {member}
            relays={chatRelays}
            canBan={isAdmin && member.pubkey !== $account?.pubkey}
            on:ban={banMember}
          />
        </div>
      {/each}

      {#if isAdmin && group}
        <h3
          class="mb-3 mt-6 text-xs font-semibold uppercase tracking-wider text-slate-400"
        >
          group settings
        </h3>
        <label
          class="flex cursor-pointer items-center gap-2 py-1 text-sm text-slate-700"
          title="only members can read messages"
        >
          <input
            type="checkbox"
            class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            checked={!group.public}
            disabled={isSending}
            on:change={e =>
              setGroupStatus(e.currentTarget.checked, !group?.open)}
          />
          private
        </label>
        <label
          class="flex cursor-pointer items-center gap-2 py-1 text-sm text-slate-700"
          title="joining requires admin approval"
        >
          <input
            type="checkbox"
            class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            checked={!group.open}
            disabled={isSending}
            on:change={e =>
              setGroupStatus(!group?.public, e.currentTarget.checked)}
          />
          closed
        </label>
      {/if}
    </aside>
  </div>
</div>

<style>
  /* message bodies are rendered from markdown as raw html, so their
     styling can't use svelte's scoped class rewriting */
  .markdown-body :global(p) {
    margin: 0;
  }
  .markdown-body :global(p + p),
  .markdown-body :global(ul),
  .markdown-body :global(ol),
  .markdown-body :global(blockquote),
  .markdown-body :global(table) {
    margin-top: 0.375rem;
  }
  .markdown-body :global(a) {
    color: rgb(79 70 229);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .markdown-body :global(a:hover) {
    color: rgb(67 56 202);
  }
  .markdown-body :global(code) {
    border-radius: 0.25rem;
    background: rgb(241 245 249);
    padding: 0.05rem 0.3rem;
    font-size: 0.8125rem;
  }
  .markdown-body :global(pre) {
    margin: 0.25rem 0;
    overflow-x: auto;
    border-radius: 0.5rem;
    background: rgb(30 41 59);
    padding: 0.5rem 0.75rem;
    color: rgb(241 245 249);
    font-size: 0.75rem;
    line-height: 1.625;
  }
  .markdown-body :global(pre code) {
    background: transparent;
    padding: 0;
    color: inherit;
    font-size: inherit;
  }
  .markdown-body :global(.md-image-link) {
    display: inline-block;
    margin-top: 0.25rem;
  }
  .markdown-body :global(img) {
    max-height: 20rem;
    max-width: min(100%, 28rem);
    border-radius: 0.5rem;
    border: 1px solid rgb(226 232 240);
    object-fit: contain;
    background: rgb(248 250 252);
  }
  .markdown-body :global(blockquote) {
    border-left: 3px solid rgb(203 213 225);
    padding-left: 0.625rem;
    color: rgb(71 85 105);
  }
  .markdown-body :global(ul) {
    list-style: disc;
    padding-left: 1.25rem;
  }
  .markdown-body :global(ol) {
    list-style: decimal;
    padding-left: 1.25rem;
  }
  .markdown-body :global(h1),
  .markdown-body :global(h2),
  .markdown-body :global(h3),
  .markdown-body :global(h4) {
    margin-top: 0.375rem;
    font-weight: 600;
  }
  .markdown-body :global(table) {
    display: block;
    overflow-x: auto;
    border-collapse: collapse;
  }
  .markdown-body :global(th),
  .markdown-body :global(td) {
    border: 1px solid rgb(226 232 240);
    padding: 0.125rem 0.5rem;
  }
</style>
