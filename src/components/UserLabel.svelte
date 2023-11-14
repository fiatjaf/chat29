<script lang="ts">
  import {onMount} from 'svelte'
  import {nip19} from 'nostr-tools'

  import {getMetadata, type Metadata} from '$lib/nostr'

  export let pubkey: string
  let metadata: Metadata
  let npub = nip19.npubEncode(pubkey)

  $: name =
    metadata?.name && metadata.name.trim() !== ''
      ? metadata.name
      : npub.slice(0, 11)
  $: picture = metadata?.picture

  onMount(async () => {
    metadata = await getMetadata(pubkey)
  })
</script>

<div class="grid grid-cols-4 items-center">
  <div class="col-start-1 col-span-1 px-2 flex items-center">
    {#if picture}
      <img src={picture} alt="user avatar" />&nbsp;
    {/if}
  </div>
  <div
    class="text-ellipsis overflow-hidden col-start-2 col-span-3 text-rose-700 text-lg pl-1"
    title={npub}
  >
    {name}
  </div>
</div>
