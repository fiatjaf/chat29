<script lang="ts">
  import {onMount} from 'svelte'
  import * as nip19 from 'nostr-tools/nip19'

  import {getMetadata, type Metadata} from '../lib/nostr.ts'

  export let pubkey: string
  // relays to look the profile up on; when omitted the public profile
  // relays are used (see getMetadata)
  export let relays: string[] | undefined = undefined
  let metadata: Metadata
  let npub = nip19.npubEncode(pubkey)
  // index into the picture candidates; bumped when an image fails to
  // load so the next known URL gets a chance
  let pictureIdx = 0

  $: name =
    metadata?.name?.trim() ||
    metadata?.display_name?.trim() ||
    npub.slice(0, 11)
  $: pictureCandidates = metadata?.pictures?.length
    ? metadata.pictures
    : metadata?.picture
      ? [metadata.picture]
      : []
  $: picture = pictureCandidates[pictureIdx] ?? null

  onMount(async () => {
    metadata = await getMetadata(pubkey, relays)
  })
</script>

<!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
<div
  class="flex min-w-0 cursor-pointer items-center gap-1.5"
  on:click={() => window.open('https://nosta.me/' + pubkey)}
  title={npub}
>
  <div class="h-6 w-6 shrink-0">
    {#if picture}
      <img
        class="aspect-square h-full w-full rounded-full border border-slate-200 bg-slate-100 object-cover"
        src={picture}
        alt="user avatar"
        on:error={() => {
          pictureIdx++
        }}
      />
    {:else}
      <img
        class="aspect-square h-full w-full rounded-full border border-slate-200 bg-slate-200 object-cover"
        alt="empty user avatar"
        src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="
      />
    {/if}
  </div>
  <div
    class="truncate text-sm font-medium text-slate-700 transition-colors hover:text-indigo-600"
    title={npub}
  >
    {name}
  </div>
</div>
