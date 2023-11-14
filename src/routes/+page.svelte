<script lang="ts">
  import debounce from 'debounce'
  import {ensureRelay} from '$lib/nostr'
  import {nip19, type Relay} from 'nostr-tools'

  let relayUrl = ''
  let connecting = false
  let failed = false
  let naddr = ''
  let groupId = ''
  let relay: Relay | null = null
  let info: {pubkey: string; name: string; description: string; icon: string}

  const tryConnect = debounce(async () => {
    try {
      let url = new URL(relayUrl)
      if (!url.protocol.startsWith('ws')) return
    } catch (err) {
      relay = null
      connecting = false
      failed = false
      return
    }

    relay = null
    connecting = true
    failed = false
    try {
      relay = await ensureRelay(relayUrl)
      info = await fetch(relayUrl.replace('ws', 'http'), {
        headers: {accept: 'application/nostr+json'}
      }).then(r => r.json())
    } catch (err) {
      failed = true
      relay = null
    }
    connecting = false
  }, 400)

  const parse = () => {
    try {
      let {data, type} = nip19.decode(naddr)
      if (type === 'naddr') {
        let {relays, identifier} = data as nip19.AddressPointer
        relayUrl = relays![0]
        tryConnect()
        groupId = identifier
      }
    } catch (err) {
      /***/
    }
  }

  const encode = debounce(() => {
    naddr = nip19.naddrEncode({
      kind: 39000,
      relays: [relay!.url],
      pubkey: info!.pubkey,
      identifier: groupId!
    })
  }, 300)
</script>

<div class="flex justify-between">
  <column>
    <div class="mt-4">
      type relay url: <input bind:value={relayUrl} on:input={tryConnect} />
    </div>
    <div class="mt-2 text-right">
      {#if relay || connecting || failed}
        <span class="text-stone-500">{relay?.url || relayUrl}</span>
      {/if}
      {#if relay}
        <span class="text-green-700">connected</span>
      {:else if connecting}
        <span class="text-blue-700">connecting</span>
      {:else if failed}
        <span class="text-red-700">failed to connect</span>
      {/if}

      {#if relay}
        <div class="mt-4">
          type group id: <input bind:value={groupId} on:input={encode} />
        </div>
      {/if}
      <div class="mt-4">
        {#if relay && groupId && naddr}
          <a
            class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-400 transition-colors"
            href="/{naddr}">open</a
          >
        {/if}
      </div>
    </div></column
  >
  <column class="flex items-center">or</column>
  <column>
    <div class="mt-4 flex items-center">
      type a group code: <textarea
        class="ml-2 h-48"
        bind:value={naddr}
        on:input={parse}
      />
    </div>
  </column>
</div>
