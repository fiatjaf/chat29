<script lang="ts">
  import debounce from 'debounce'
  import {
    type Group,
    type GroupReference,
    subscribeRelayGroups,
    parseGroupCode,
    encodeGroupReference
  } from 'nostr-tools/nip29'

  import {pool} from '../lib/nostr.ts'
  import Header from '../components/Header.svelte'
  import GroupsList from '../components/GroupsList.svelte'

  let status: 'connecting' | 'connected' | 'failed' | null = null
  let code = ''
  let gr: GroupReference = {id: '', host: ''}
  let cancel: () => void
  let channels: Group[] = []

  const tryConnect = debounce(async () => {
    if (cancel) {
      cancel()
      channels = []
    }
    status = 'connecting'

    cancel = subscribeRelayGroups(pool, gr.host, {
      ongroups(groups: Group[]) {
        groups = groups
      },
      onerror(err: Error) {
        console.warn('failed to load groups from relay', gr.host, err)
        status = 'failed'
      }
    })
  }, 400)

  const parse = () => {
    let res = parseGroupCode(code)
    if (res) gr = res
  }

  const encode = debounce(() => {
    code = gr ? encodeGroupReference(gr) : ''
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
      type relay url: <input bind:value={gr.host} on:input={tryConnect} />
    </div>
    <div class="mt-2 pl-4">
      {#if status === 'connecting' || status === 'failed'}
        <span class="text-stone-500">{gr.host}</span>
      {/if}
      {#if status === 'connected'}
        <span class="text-green-700">connected</span>
      {:else if status === 'connecting'}
        <span class="text-blue-700">connecting</span>
      {:else if status === 'failed'}
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
                gr.id = channel.id
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

    {#if status === 'connected'}
      <div class="mt-4">
        type group id: <input bind:value={gr.id} on:input={encode} />
      </div>
    {/if}

    <div class="mt-4">
      {#if gr.id !== '' && gr.host !== ''}
        <a
          class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-400 transition-colors"
          href="/{code}">open</a
        >
      {/if}
    </div>
  </column>
  <div class="flex items-center justify-center uppercase text-2xl mx-4">or</div>
  <column class="">
    <div class="mt-4 flex items-center">
      type a group code: <input
        class="ml-2"
        bind:value={code}
        on:input={parse}
      />
    </div>
  </column>
</div>
