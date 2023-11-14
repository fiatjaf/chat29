<script lang="ts">
  import {nip19, type Event, type Relay, type Sub} from 'nostr-tools'
  import {onMount} from 'svelte'

  import {afterNavigate} from '$app/navigation'
  import {page} from '$app/stores'
  import {ensureRelay} from '$lib/nostr'
  import {debounce} from 'debounce'
  import UserLabel from '$components/UserLabel.svelte'

  let naddr = $page.params.naddr
  let groupId: string | null = null
  let messages: Event[] = []
  let groupMetadata: {
    name: string | null
    picture: string | null
    about: string
  } = {
    name: null,
    picture: null,
    about: ''
  }
  let info: {pubkey: string; name: string; description: string; icon: string}
  let relay: Relay
  let error: string
  let sub: Sub
  let eoseHappened = false

  onMount(() => {
    loadChat()
    return unloadChat
  })
  afterNavigate(() => {
    if (naddr === $page.params.naddr) return
    unloadChat()
    loadChat()
  })

  function unloadChat() {
    if (sub) sub.unsub()
    eoseHappened = false
    messages = []
    groupMetadata = {name: null, picture: null, about: ''}
    groupId = null
  }

  async function loadChat() {
    naddr = $page.params.naddr

    try {
      let {data, type} = nip19.decode(naddr)
      if (type !== 'naddr') return

      let {relays, identifier} = data as nip19.AddressPointer
      if (!relays || relays.length === 0) return

      let relayUrl = relays![0]
      groupId = identifier

      relay = await ensureRelay(relayUrl)
      info = await fetch(relayUrl.replace('ws', 'http'), {
        headers: {accept: 'application/nostr+json'}
      }).then(r => r.json())

      let sub = relay.sub([
        {kinds: [9], '#h': [groupId], limit: 700},
        {kinds: [39000], '#d': [groupId]}
      ])

      sub.on('event', event => {
        switch (event.kind) {
          case 39000:
            event.tags.forEach(tag => {
              switch (tag[0]) {
                case 'name':
                  if (tag[1] && tag[1].trim().length > 0)
                    groupMetadata.name = tag[1].trim()
                case 'picture':
                  if (tag[1]) groupMetadata.picture = tag[1]
                case 'about':
                  if (tag[1]) groupMetadata.picture = tag[1]
              }
            })
            break
          case 9:
            messages.push(event as any)
            if (eoseHappened) updateMessages()
            break
        }
      })

      sub.on('eose', () => {
        messages = messages.reverse()
        eoseHappened = true
      })
    } catch (err: any) {
      error = err.message
    }
  }

  const updateMessages = debounce(() => {
    messages = messages
  }, 300)

  $: groupRawName = relay ? `${groupId}@${new URL(relay.url).host}` : ''
</script>

<header class="my-4 flex items-center">
  <div class="text-sm">room</div>
  <div class="text-emerald-600 text-lg mx-4">
    {groupMetadata.name || groupRawName || $page.params.naddr}
  </div>
  <div class="text-xs text-stone-400">{groupRawName}</div>
</header>
{#if error}
  <div class="w-full flex justify-center items-center h-24 text-xl">
    {error}
  </div>
{:else}
  <div class="flex flex-col ml-4">
    {#each messages as message}
      <div class="grid grid-cols-5 gap-2 items-center hover:bg-stone-200">
        <div class="col-start-1 col-span-1">
          <UserLabel pubkey={message.pubkey} />
        </div>
        <div class="col-start-auto col-span-4">
          {message.content}
        </div>
      </div>
    {/each}
  </div>
{/if}
