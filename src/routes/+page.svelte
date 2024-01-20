<script lang="ts">
  import debounce from 'debounce'
  import * as nip19 from 'nostr-tools/nip19'
  import type {Event} from 'nostr-tools/wasm'
  import type {Subscription, Relay} from 'nostr-tools/relay'
  import {parseGroup, type Group} from 'nostr-tools/nip29'

  import {pool} from '../lib/nostr.ts'
  import Header from '../components/Header.svelte'
  import GroupsList from '../components/GroupsList.svelte'

  let relayUrl = ''
  let connecting = false
  let failed = false
  let naddr = ''
  let groupId = ''
  let relay: Relay | null = null
  let sub: Subscription
  let channels: Group[] = []
  let info: {pubkey: string; name: string; description: string; icon: string}

  const tryConnect = debounce(async () => {
    if (sub) {
      sub.close()
      channels = []
    }
    let normalized = relayUrl.startsWith('ws') ? relayUrl : 'wss://' + relayUrl

    try {
      let url = new URL(normalized)
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
    let eosed = true
    try {
      await Promise.all([
        pool.ensureRelay(normalized).then(rl => {
          relay = rl
          sub = rl.subscribe(
            [
              {
                kinds: [39000],
                limit: 50
              }
            ],
            {
              onevent(event: Event) {
                channels.push(parseGroup(event))
                if (eosed) channels = channels
              },
              oneose() {
                channels = channels
                eosed = true
              }
            }
          )
        }),
        fetch(normalized.replace(/^ws/, 'http'), {
          headers: {accept: 'application/nostr+json'}
        })
          .then(r => r.json())
          .then(i => {
            info = i
          })
      ])
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

<h1 class="text-2xl h-1/6">
  <Header />
</h1>
<div class="flex">
  <column class="mr-8">
    <GroupsList />
  </column>
  <column class="">
    <div class="mt-4">
      type relay url: <input bind:value={relayUrl} on:input={tryConnect} />
    </div>
    <div class="mt-2 pl-4">
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
    </div>

    <div class="mt-4">
      {#each channels as channel}
        <div class="mt-1 pl-4 max-h-64">
          <div class="flex">
            <!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
            <div
              class="cursor-pointer hover:underline text-blue-700"
              on:click={() => {
                groupId = channel.id
                encode()
              }}
            >
              {channel.id}
            </div>
            <div class="ml-4 text-stone-600">{channel.name}</div>
          </div>
        </div>
      {/each}
    </div>

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
  </column>
  <div class="flex items-center justify-center uppercase text-2xl mx-4">or</div>
  <column class="">
    <div class="mt-4 flex items-center">
      type a group code: <textarea
        class="ml-2 h-48"
        bind:value={naddr}
        on:input={parse}
      />
    </div>
  </column>
</div>
