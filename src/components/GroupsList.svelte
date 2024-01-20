<script lang="ts">
  import type {Group} from 'nostr-tools/nip29'
  import type {Event} from 'nostr-tools/wasm'
  import * as nip19 from 'nostr-tools/nip19'

  import {account, defaultRelays, publish} from '../lib/nostr.ts'
  import {showToast} from '$lib/utils.ts'

  export let current: Group | null = null

  function naddrEncode(group: Group): string {
    let relay = group.relay as string
    return nip19.naddrEncode({
      kind: 39000,
      relays: [relay],
      pubkey: $account?.pubkey as string,
      identifier: group.id
    })
  }

  async function addGroupToList() {
    if (!current) return

    // we save this group to our list no matter what
    let {tags, content}: Pick<Event, 'content' | 'tags'> =
      $account?.lastGroupsList || {
        content: '',
        tags: []
      }
    tags.push(['group', current.id, current.relay as string])
    try {
      await publish(
        {
          kind: 10009,
          content,
          tags,
          created_at: Math.round(Date.now() / 1000)
        },
        $account?.writeRelays || defaultRelays
      )
    } catch (err) {
      console.warn('failed to publish groups list', err)
      showToast({type: 'error', text: String(err)})
    }
  }

  async function removeGroupFromList(group: Group) {
    let listEvent = $account?.lastGroupsList
    if (!listEvent) return

    let {tags, content} = listEvent

    let idx = listEvent.tags.findIndex(tag => tag[1] === group.id)
    if (idx !== -1) {
      tags.splice(idx, 1)
      try {
        await publish(
          {
            kind: 10009,
            content,
            tags,
            created_at: Math.round(Date.now() / 1000)
          },
          $account?.writeRelays || defaultRelays
        )
      } catch (err) {
        console.warn('failed to publish groups list', err)
        showToast({type: 'error', text: String(err)})
      }
    }
  }
</script>

<div class="flex flex-col pr-8">
  <h3 class="text-lg text-emerald-600 mb-2">groups</h3>

  {#if current && $account && $account.groups.findIndex(g => g.id === current?.id) === -1}
    <button
      class="p-1 my-2 text-xs bg-blue-500 hover:bg-blue-400 text-white rounded transition-colors"
      on:click={addGroupToList}>add this group to list?</button
    >
  {/if}

  {#each $account?.groups || [] as group (group.id)}
    <div class="flex px-1" class:bg-emerald-200={group.id === current?.id}>
      {#if group.picture}
        <img src={group.picture} alt="group" />
      {/if}
      {#if group.id !== current?.id}
        <a class="cursor-pointer hover:underline" href={naddrEncode(group)}
          >{group.name}</a
        >
      {:else}
        <span>{group.name}</span>
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
