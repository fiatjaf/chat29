<script lang="ts">
  import debounce from 'debounce'
  import * as nip19 from 'nostr-tools/nip19'
  import type {Event} from 'nostr-tools/pure'
  import type {Subscription, Relay} from 'nostr-tools/relay'

  import {pool, signer} from '../lib/nostr.ts'
  import {parseGroup, type Group} from '../lib/group.ts'
  import Header from '../components/Header.svelte'
  import {account} from '../lib/nostr.ts'

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
              },
              oneose() {
                channels = channels
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
<div class="grid grid-cols-9 gap-2">
  <column class="col-span-3">
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
  <column class="col-span-1 flex items-center justify-center uppercase text-2xl"
    >or</column
  >
  <column class="col-span-2">
    <div class="mt-4 flex items-center">
      type a group code: <textarea
        class="ml-2 h-48"
        bind:value={naddr}
        on:input={parse}
      />
    </div>
  </column>
  <column class="col-span-3">
    {#if $account}
      {#each $account.groups as group (group.id)}
        <div class="grid" style="grid-template-areas: '';">{group.id}</div>
      {/each}
    {/if}
  </column>
</div>
