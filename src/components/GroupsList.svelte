<script lang="ts">
  import type {Group} from 'nostr-tools/nip29'
  import {normalizeURL} from 'nostr-tools/utils'
  import * as nip19 from 'nostr-tools/nip19'

  import {
    account,
    defaultRelays,
    publish,
    getMetadata,
    profileRelays,
    type ChatGroup
  } from '../lib/nostr.ts'
  import {showToast} from '$lib/utils.ts'

  export let current: Group | null = null

  // Buzz names every DM channel "DM", so several entries in the list can
  // share a name. Those get the other participant's name appended.
  let counterparts: Record<string, string> = {}

  $: groups = ($account?.groups || []) as ChatGroup[]
  $: duplicatedNames = new Set(
    groups
      .map(g => g.name)
      .filter(
        (name, i, all) => !!name && all.indexOf(name) !== all.lastIndexOf(name)
      ) as string[]
  )
  $: if (duplicatedNames.size) resolveCounterparts(groups)

  function groupKey(g: Group): string {
    return `${g.relay}'${g.id}`
  }

  async function resolveCounterparts(list: ChatGroup[]) {
    for (const g of list) {
      const key = groupKey(g)
      if (!g.name || !duplicatedNames.has(g.name)) continue
      if (counterparts[key] !== undefined) continue
      const other = (g.participants || []).find(p => p !== $account?.pubkey)
      if (!other) continue
      counterparts[key] = '' // don't look the same pubkey up twice
      try {
        const md = await getMetadata(other, [
          ...(g.relay ? [g.relay] : []),
          ...profileRelays
        ])
        const name = md.name?.trim() || md.display_name?.trim()
        counterparts[key] = name || nip19.npubEncode(other).slice(0, 11)
        counterparts = counterparts
      } catch (err) {
        /* leave it unlabelled */
      }
    }
  }

  // what the sidebar shows for a group: its name, plus the other
  // participant when the name alone is ambiguous
  function displayName(g: ChatGroup): string {
    const base = g.name || g.id
    if (!g.name || !duplicatedNames.has(g.name)) return base
    const who = counterparts[groupKey(g)]
    return who ? `${base} · ${who}` : base
  }

  function sameRelay(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b) return a === b
    try {
      return normalizeURL(a) === normalizeURL(b)
    } catch (err) {
      return a === b
    }
  }

  function sameGroup(a: Group, b: Group): boolean {
    return a.id === b.id && sameRelay(a.relay, b.relay)
  }

  function groupLink(group: Group): string {
    if (group.pubkey) {
      try {
        return (
          '/' +
          nip19.naddrEncode({
            kind: 39000,
            relays: [group.relay],
            pubkey: group.pubkey,
            identifier: group.id
          })
        )
      } catch (err) {
        /* fall through to the plain host'id form */
      }
    }
    const host = (group.relay || '')
      .replace(/^wss?:\/\//, '')
      .replace(/\/$/, '')
    return `/${host}'${group.id}`
  }

  function publishRelays(): string[] {
    const writeRelays = $account?.writeRelays
    return writeRelays && writeRelays.length ? writeRelays : defaultRelays
  }

  async function addGroupToList() {
    if (!current) return

    const listEvent = $account?.lastGroupsList
    // work on a copy: mutating the store's event would corrupt local
    // state even when the publish fails
    const content = listEvent?.content || ''
    const tags = (listEvent?.tags || []).map(tag => [...tag])

    const relayURL = current.relay as string
    const exists = tags.some(
      tag =>
        tag[0] === 'group' &&
        tag[1] === current?.id &&
        sameRelay(tag[2], relayURL)
    )
    if (exists) return

    tags.push(['group', current.id, relayURL])
    try {
      await publish(
        {
          kind: 10009,
          content,
          tags,
          created_at: Math.round(Date.now() / 1000)
        },
        publishRelays()
      )
    } catch (err) {
      console.warn('failed to publish groups list', err)
      showToast({type: 'error', text: String(err)})
    }
  }

  async function removeGroupFromList(group: Group) {
    const listEvent = $account?.lastGroupsList
    if (!listEvent) return

    const content = listEvent.content
    const tags = listEvent.tags.map(tag => [...tag])

    const idx = tags.findIndex(
      tag =>
        tag[0] === 'group' &&
        tag[1] === group.id &&
        (tag.length < 3 || sameRelay(tag[2], group.relay))
    )
    if (idx === -1) return

    tags.splice(idx, 1)
    try {
      await publish(
        {
          kind: 10009,
          content,
          tags,
          created_at: Math.round(Date.now() / 1000)
        },
        publishRelays()
      )
    } catch (err) {
      console.warn('failed to publish groups list', err)
      showToast({type: 'error', text: String(err)})
    }
  }
</script>

<div class="flex w-full flex-col">
  <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
    your groups
  </h3>

  {#if !$account}
    <div class="text-sm leading-relaxed text-slate-400">
      login (top right) to keep a list of your groups here
    </div>
  {:else if !$account.groups.length && !current}
    <div class="text-sm leading-relaxed text-slate-400">
      no groups saved yet — join a group and add it to your list
    </div>
  {/if}

  {#each groups as group (`${group.relay}'${group.id}`)}
    <div
      class="group flex items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors"
      class:bg-indigo-50={current && sameGroup(group, current)}
      class:text-indigo-700={current && sameGroup(group, current)}
      class:hover:bg-slate-100={!current || !sameGroup(group, current)}
    >
      <div class="flex min-w-0 items-center gap-2">
        {#if group.picture}
          <img
            class="h-5 w-5 shrink-0 rounded object-cover"
            src={group.picture}
            alt="group"
          />
        {/if}
        {#if !current || !sameGroup(group, current)}
          <a
            class="cursor-pointer truncate hover:underline"
            title={group.id}
            href={groupLink(group)}>#{displayName(group)}</a
          >
        {:else}
          <span class="truncate font-medium" title={group.id}
            >#{displayName(group)}</span
          >
        {/if}
      </div>
      <!-- svelte-ignore a11y-no-static-element-interactions a11y-missing-attribute -->
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <a
        class="cursor-pointer text-slate-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
        on:click={() => removeGroupFromList(group)}
        title="remove group from list"
      >
        ×
      </a>
    </div>
  {/each}

  <!-- kept below the list: toggling this button while switching groups
       must not shift the group rows above it -->
  {#if current && $account && !$account.groups.some(g => current && sameGroup(g, current))}
    <button
      class="my-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
      on:click={addGroupToList}>add this group to list?</button
    >
  {/if}
</div>
