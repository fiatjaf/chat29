<script lang="ts">
  import * as nip19 from 'nostr-tools/nip19'

  import {afterNavigate} from '$app/navigation'
  import {page} from '$app/stores'

  import ChatPage from '../../pages/ChatPage.svelte'
  import SelectPage from '../../pages/SelectPage.svelte'

  let host = ''
  let id = ''

  afterNavigate(() => {
    let code = $page.params.code

    // this component instance is reused across navigations, so start
    // from a clean slate or the previous room's values leak into the
    // next one (e.g. /relay.host would open the previously viewed id)
    host = ''
    id = ''

    if (code.startsWith('naddr1')) {
      try {
        let {data, type} = nip19.decode(code)
        if (type !== 'naddr') return

        let {relays, identifier} = data as nip19.AddressPointer
        if (!relays || relays.length === 0) return

        host = relays[0].replace(/^wss?:\/\//, '').replace(/\/+$/, '')
        id = identifier
      } catch (err) {
        console.warn('invalid naddr', code, err)
      }
    } else if (code.split("'").length === 2) {
      let spl = code.split("'")
      // hosts copied from relay URLs may carry a trailing slash (the
      // route is a rest parameter exactly so such codes still match)
      host = spl[0].replace(/\/+$/, '')
      id = spl[1]
    } else if (code.split('.').length > 1) {
      host = code.replace(/\/+$/, '')
    }

    // remember the last opened group so `/` can jump straight back to it
    if (host && id) {
      localStorage.setItem('lastGroupCode', code)
    }
  })
</script>

{#if host && id}
  <ChatPage {host} {id} />
{:else if host}
  <SelectPage initialHost={host} />
{:else}
  <div class="p-8">not found</div>
{/if}
