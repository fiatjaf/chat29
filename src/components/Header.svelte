<script>
  import {account} from '$lib/nostr'
  import UserLabel from './UserLabel.svelte'
</script>

<div class="flex justify-between">
  <div>
    <a href="/" class="text-stone-600 text-lg hover:underline">chat29</a>
    <span class="text-xs"
      >: <a
        href="https://github.com/nostr-protocol/nips/blob/simple-chat-groups/29.md"
        class="text-blue-500 hover:underline"
        target="_blank">NIP-29</a
      >-based barebones chat client.
    </span>
  </div>
  <div class="w-1/6">
    {#if $account}
      <UserLabel pubkey={$account.pubkey} />
    {/if}
  </div>
</div>
