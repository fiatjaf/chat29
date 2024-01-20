<script lang="ts">
  import type {Member} from 'nostr-tools/nip29'
  import UserLabel from './UserLabel.svelte'
  import {createEventDispatcher} from 'svelte'

  export let member: Member
  export let canBan: boolean = false

  const dispatch = createEventDispatcher()

  function handleBanClick() {
    dispatch('ban', {member})
  }
</script>

<div class="flex items-center">
  <UserLabel pubkey={member.pubkey} />
  {#if canBan}
    <!-- svelte-ignore a11y-no-static-element-interactions a11y-missing-attribute -->
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <a
      class="ml-2 hover:text-red-600 cursor-pointer"
      on:click={handleBanClick}
      title="remove member from group"
    >
      ×
    </a>
  {/if}
</div>
