<script lang="ts">
  import * as nip19 from 'nostr-tools/nip19'

  import {afterNavigate} from '$app/navigation'
  import {page} from '$app/stores'

  import ChatPage from '../../pages/ChatPage.svelte'
  import RelayPage from '../../pages/RelayPage.svelte'

  let host: string
  let id: string

  afterNavigate(() => {
    let code = $page.params.code

    if (code.startsWith('naddr1')) {
      let {data, type} = nip19.decode(code)
      if (type !== 'naddr') return

      let {relays, identifier} = data as nip19.AddressPointer
      if (!relays || relays.length === 0) return

      host = relays![0]
      if (host.startsWith('wss://')) {
        host = host.slice(6)
      }
      id = identifier
    } else if (code.split('#').length === 2) {
      let spl = code.split('#')
      host = spl[0]
      id = spl[1]
    } else if (code.split('.').length > 1) {
      host = code
    }
  })
</script>

{#if host && id}
  <ChatPage {host} {id} />
{:else if host}
  <RelayPage {host} />
{:else}
  <div class="p-8">not found</div>
{/if}
