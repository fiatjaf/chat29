<script>
  import UserLabel from './UserLabel.svelte'
  import {account, signer} from '../lib/nostr.ts'
</script>

<div class="flex items-center justify-between gap-4">
  <div class="flex items-center gap-3">
    <a href="/" class="flex items-center gap-2">
      <span
        class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-sm font-bold text-white shadow-sm"
        >29</span
      >
      <span class="text-lg font-semibold tracking-tight text-slate-900"
        >chat29</span
      >
    </a>
    <a
      href="https://github.com/nostr-protocol/nips/blob/simple-chat-groups/29.md"
      target="_blank"
      class="hidden rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-500 transition-colors hover:border-indigo-300 hover:text-indigo-600 sm:inline-block"
      >NIP-29</a
    >
  </div>
  <div class="shrink-0">
    {#if $account}
      <div
        class="flex items-center gap-3 rounded-full border border-slate-200 bg-white py-1 pl-1.5 pr-3 shadow-sm"
      >
        <UserLabel pubkey={$account.pubkey} />
        <button
          class="text-xs text-slate-400 transition-colors hover:text-slate-600"
          on:click={() => signer.signOut()}>logout</button
        >
      </div>
    {:else}
      <button
        class="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
        on:click={() => signer.getPublicKey()}
      >
        login
      </button>
    {/if}
  </div>
</div>
