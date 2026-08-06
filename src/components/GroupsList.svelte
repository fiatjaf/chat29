<script lang="ts">
  import type {Group} from 'nostr-tools/nip29'
  import {normalizeURL} from 'nostr-tools/utils'
  import * as nip19 from 'nostr-tools/nip19'

  import {account, defaultRelays, publish} from '../lib/nostr.ts'
  import {showToast} from '$lib/utils.ts'

  export let current: Group | null = null

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

<div class="flex flex-col pr-8">
  <h3 class="text-lg text-emerald-600 mb-2">groups</h3>

  {#if current && $account && !$account.groups.some(g => current && sameGroup(g, current))}
    <button
      class="p-1 my-2 text-xs bg-blue-500 hover:bg-blue-400 text-white rounded transition-colors"
      on:click={addGroupToList}>add this group to list?</button
    >
  {/if}

  {#each $account?.groups || [] as group (`${group.relay}'${group.id}`)}
    <div
      class="flex px-1"
      class:bg-emerald-200={current && sameGroup(group, current)}
    >
      {#if group.picture}
        <img src={group.picture} alt="group" />
      {/if}
      {#if !current || !sameGroup(group, current)}
        <a class="cursor-pointer hover:underline" href={groupLink(group)}
          >{group.name || group.id}</a
        >
      {:else}
        <span>{group.name || group.id}</span>
      {/if}
      <!-- svelte-ignore a11y-no-static-element-interactions a11y-missing-attribute -->
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <a
        class="hover:text-red-600 text-stone-400 cursor-pointer ml-1"
        on:click={() => removeGroupFromList(group)}
        title="remove group from list"
      >
        ×
      </a>
      &nbsp;
    </div>
  {/each}
</div>
