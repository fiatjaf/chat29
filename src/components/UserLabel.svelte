<script lang="ts">
  import {onMount} from 'svelte'
  import * as nip19 from 'nostr-tools/nip19'

  import {getMetadata, type Metadata} from '../lib/nostr.ts'

  export let pubkey: string
  let metadata: Metadata
  let npub = nip19.npubEncode(pubkey)
  let imgError = false

  $: name =
    metadata?.name && metadata.name.trim() !== ''
      ? metadata.name
      : npub.slice(0, 11)
  $: picture = imgError ? null : metadata?.picture

  onMount(async () => {
    metadata = await getMetadata(pubkey)
  })
</script>

<!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
<div
  class="flex items-center cursor-pointer"
  on:click={() => window.open('https://nosta.me/' + pubkey)}
  title={npub}
>
  <div class="h-6 mr-1">
    {#if picture}
      <img
        class="aspect-square h-full border border-stone-300 object-cover"
        src={picture}
        alt="user avatar"
        on:error={() => {
          imgError = true
        }}
      />&nbsp;
    {:else}
      <img
        class="aspect-square h-full border border-stone-300 object-cover"
        alt="empty user avatar"
        src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="
      />
    {/if}
  </div>
  <div
    class="text-ellipsis overflow-hidden text-rose-700 text-lg pl-1"
    title={npub}
  >
    {name}
  </div>
</div>
