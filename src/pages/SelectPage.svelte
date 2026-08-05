<script lang="ts">
  import debounce from 'debounce'
  import {
    type Group,
    type GroupReference,
    parseGroupCode,
    encodeGroupReference
  } from 'nostr-tools/nip29'

  import {account, subscribeRelayGroupsWithAuth} from '../lib/nostr.ts'
  import Header from '../components/Header.svelte'
  import GroupsList from '../components/GroupsList.svelte'
  import {afterUpdate, onDestroy} from 'svelte'

  export let initialHost: string | null = null

  let gr: GroupReference = {id: '', host: ''}
  let status: 'connecting' | 'connected' | 'failed' | null = null
  let errorMessage = ''
  let code = ''
  let cancel: () => void
  let channels: Group[] = []
  let memberships: Record<string, string[]> = {}

  afterUpdate(() => {
    if (initialHost) {
      gr.host = initialHost
      gr.id = ''
      initialHost = null
      tryConnect()
    }
  })

  onDestroy(() => {
    if (cancel) cancel()
  })

  const tryConnect = debounce(async () => {
    // wait until the input looks like a host at all
    if (gr.host.length < 5 || gr.host.split('.').length < 2) return

    if (cancel) {
      cancel()
      channels = []
    }
    status = 'connecting'
    errorMessage = ''

    cancel = subscribeRelayGroupsWithAuth(gr.host, {
      ongroups(groups: Group[], m: Record<string, string[]>) {
        status = 'connected'
        // never let a racing empty snapshot blank out a visible list
        if (groups.length || !channels.length) channels = groups
        if (Object.keys(m).length || !Object.keys(memberships).length)
          memberships = m
      },
      onerror(err: Error) {
        console.warn('failed to load groups from relay', gr.host, err)
        status = 'failed'
        errorMessage = err.message
      }
    })
  }, 400)

  const parse = () => {
    let res = parseGroupCode(code)
    if (res) gr = res
  }

  // nostr-tools' encodeGroupReference strips the protocol but not a
  // trailing slash; a host like "relay.example.com/" would produce a
  // two-segment path ("/relay.example.com/'id") and break routing
  const encodeRef = (r: GroupReference) =>
    encodeGroupReference({...r, host: r.host.trim().replace(/\/+$/, '')})

  const encode = debounce(() => {
    code = gr ? encodeRef(gr) : ''
  }, 300)


  // the "open" link must not wait for the debounced `encode`, otherwise a
  // quick click right after selecting a group would navigate to "/"
  let openHref = ''
  $: if (gr.id !== '' && gr.host !== '') {
    try {
      openHref = '/' + encodeRef(gr)
    } catch (err) {
      openHref = ''
    }
  } else {
    openHref = ''
  }
</script>

<div class="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-5">
  <Header />

  <div class="mt-12 text-center">
    <h2 class="text-3xl font-bold tracking-tight text-slate-900">
      group chat over nostr
    </h2>
    <p class="mt-2 text-sm text-slate-500">
      a barebones NIP-29 chat client — pick a relay, pick a group, start
      talking
    </p>
  </div>

  <div class="mt-12 grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
    <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <GroupsList />
    </div>

    <div class="grid items-start gap-6 md:grid-cols-2">
      <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 class="text-base font-semibold text-slate-900">
          join a group on a relay
        </h3>
        <p class="mt-1 text-sm text-slate-500">
          connect to a relay to browse its public groups
        </p>

        <label
          class="mt-5 block text-xs font-medium uppercase tracking-wider text-slate-400"
          for="relay-url">relay url</label
        >
        <input
          id="relay-url"
          class="mt-1.5 w-full rounded-lg border-slate-300 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          placeholder="groups.0xchat.com"
          bind:value={gr.host}
          on:input={tryConnect}
        />
        <div class="mt-1.5 h-5 text-sm">
          {#if status === 'connected'}
            <span class="inline-flex items-center gap-1.5 text-emerald-600">
              <span class="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              connected
            </span>
          {:else if status === 'connecting'}
            <span class="inline-flex items-center gap-1.5 text-slate-400">
              <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
              connecting…
            </span>
          {:else if status === 'failed'}
            <span class="inline-flex items-center gap-1.5 text-red-600">
              <span class="h-1.5 w-1.5 rounded-full bg-red-500" />
              failed to connect
            </span>
          {/if}
        </div>
        {#if status === 'failed' && errorMessage}
          <div class="mt-1 text-xs leading-relaxed text-red-500">
            {errorMessage}
          </div>
        {/if}

        {#if status === 'connected'}
          {#if channels.length}
            <div
              class="mt-3 text-xs font-medium uppercase tracking-wider text-slate-400"
            >
              groups on this relay — click to enter
            </div>
            <div
              class="mt-1.5 max-h-64 overflow-y-auto rounded-lg border border-slate-100"
            >
              {#each channels as channel (channel.id)}
                {@const joined = !!(
                  $account &&
                  memberships[channel.id]?.includes($account.pubkey)
                )}
                <div
                  class="flex items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-indigo-50"
                >
                  <a
                    class="min-w-0 flex-1 truncate font-medium"
                    class:text-emerald-600={joined}
                    class:text-slate-700={!joined}
                    title={channel.id}
                    href={'/' + encodeRef({host: gr.host, id: channel.id})}
                    >#{channel.name || channel.id}</a
                  >
                  {#if joined}
                    <span
                      class="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                      title="you are a member"
                    />
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <div class="mt-3 text-sm text-slate-400">
              this relay lists no public groups — if you know a group id, type
              it below
            </div>
          {/if}

          <label
            class="mt-4 block text-xs font-medium uppercase tracking-wider text-slate-400"
            for="group-id">or type a group id</label
          >
          <input
            id="group-id"
            class="mt-1.5 w-full rounded-lg border-slate-300 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            bind:value={gr.id}
            on:input={encode}
          />
        {/if}
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 class="text-base font-semibold text-slate-900">
          join with a group code
        </h3>
        <p class="mt-1 text-sm text-slate-500">got a code? paste it here</p>

        <label
          class="mt-5 block text-xs font-medium uppercase tracking-wider text-slate-400"
          for="group-code">group code</label
        >
        <input
          id="group-code"
          class="mt-1.5 w-full rounded-lg border-slate-300 font-mono text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          placeholder="naddr1…"
          bind:value={code}
          on:input={parse}
        />
        <div class="mt-2 text-xs leading-relaxed text-slate-400">
          a code someone shared with you, like
          <span class="font-mono">naddr1…</span> or
          <span class="font-mono">relay.host'group-id</span>
        </div>
      </div>
    </div>
  </div>

  {#if openHref !== ''}
    <div class="mt-10 flex justify-center">
      <a
        class="rounded-xl bg-indigo-600 px-8 py-3 font-medium text-white shadow-md transition-colors hover:bg-indigo-500"
        href={openHref}
      >
        open <span class="font-semibold">{gr.id}</span> on {gr.host} →
      </a>
    </div>
  {/if}
</div>
