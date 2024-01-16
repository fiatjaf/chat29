<script lang="ts">
  import type {Event} from 'nostr-tools/pure'
  import type {AbstractRelay, Subscription} from 'nostr-tools/abstract-relay'
  import * as nip19 from 'nostr-tools/nip19'
  import {onMount} from 'svelte'
  import {debounce} from 'debounce'

  import {afterNavigate} from '$app/navigation'
  import {page} from '$app/stores'
  import {pool, publish} from '../../lib/nostr.ts'
  import {humanDate} from '../../lib/utils.ts'
  import UserLabel from '../../components/UserLabel.svelte'
  import Header from '../../components/Header.svelte'

  let naddr = $page.params.naddr
  let groupId: string | null = null
  let messages: Event[] = []
  let text = localStorage.getItem('text') || ''
  let readOnly = false
  let controlIsDown = false
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
  let relay: AbstractRelay
  let sub: Subscription
  let error: string
  let eoseHappened = false

  $: groupRawName = relay ? `${groupId}@${new URL(relay.url).host}` : ''

  const updateMessages = debounce(() => {
    messages = messages
    scrollToEnd()
  }, 300)

  const saveToLocalStorage = debounce(() => {
    localStorage.setItem('text', text)
  }, 2000)

  function scrollToEnd() {
    setTimeout(() => {
      document
        .getElementById(`evt-${messages[messages.length - 1].id.substring(-6)}`)
        ?.scrollIntoView()
    }, 25)
  }

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
    if (sub) sub.close()
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

      relay = await pool.ensureRelay(relayUrl)
      info = await fetch(relayUrl.replace('ws', 'http'), {
        headers: {accept: 'application/nostr+json'}
      }).then(r => r.json())

      sub = relay.subscribe(
        [
          {kinds: [9], '#h': [groupId], limit: 700},
          {kinds: [39000], '#d': [groupId]}
        ],
        {
          onevent(event) {
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
          },
          oneose() {
            messages = messages.reverse()
            scrollToEnd()
            eoseHappened = true
          },
          onclose(reason) {
            console.warn(relay.url, 'relay connection closed', reason)
          }
        }
      )
    } catch (err: any) {
      error = err.message
    }
  }

  async function sendMessage() {
    try {
      readOnly = true
      await publish(
        {
          kind: 9,
          content: text,
          tags: [['h', groupId!]],
          created_at: Math.round(Date.now() / 1000)
        },
        [relay.url]
      )
      text = ''
      saveToLocalStorage()
      readOnly = false
    } catch (err) {
      console.log('failed to send', err)
    }
  }

  function onKeyDown(ev: KeyboardEvent) {
    if (ev.repeat) return
    switch (ev.key) {
      case 'Control':
        controlIsDown = true
        ev.preventDefault()
    }
  }

  function onKeyUp(ev: KeyboardEvent) {
    switch (ev.key) {
      case 'Control':
        controlIsDown = false
        ev.preventDefault()
      case 'Enter':
        if (controlIsDown) sendMessage()
        ev.preventDefault()
    }
  }
</script>

<svelte:window on:keydown={onKeyDown} on:keyup={onKeyUp} />

<header class="pb-8 h-1/6">
  <div><Header /></div>
  <div class="flex items-center">
    <div class="text-sm w-1/12 text-right">room</div>
    <div
      class="text-emerald-600 text-lg mx-4 w-8/12 overflow-hidden text-ellipsis"
    >
      {groupMetadata.name || groupRawName || $page.params.naddr}
    </div>
    <div class="text-xs text-stone-400 w-3/12 text-right">{groupRawName}</div>
  </div>
</header>
{#if error}
  <section class="w-full flex justify-center items-center h-4/5 text-xl">
    {error}
  </section>
{:else}
  <section class="row-span-9 overflow-y-auto h-4/6">
    <div class="flex flex-col">
      <div class="h-full overflow-auto">
        {#each messages as message}
          <div
            class="grid grid-cols-12 gap-2 items-center hover:bg-emerald-100"
            id={`evt-${message.id.substring(-6)}`}
          >
            <div class="col-start-1 col-span-2">
              <UserLabel imgClass="max-h-3.5" pubkey={message.pubkey} />
            </div>
            <div class="col-start-auto col-span-8">
              {message.content}
            </div>
            <div
              class="col-start-auto col-span-2 flex justify-end text-stone-400 text-xs"
              title={new Date(message.created_at * 1000).toString()}
            >
              {humanDate(message.created_at)}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>
  <section class="h-1/6">
    <form
      on:submit={sendMessage}
      class="grid grid-cols-7 gap-2 pt-4 mb-2 h-full py-4"
    >
      <textarea
        class="h-full w-full bg-stone-100 col-span-6"
        placeholder="type a message here (and use Ctrl+Enter to send)"
        bind:value={text}
        on:input={saveToLocalStorage}
        readonly={readOnly}
      />
      <div class="col-span-1">
        <button
          class="h-full w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-400 transition-colors"
          disabled={readOnly || !groupId || !relay}
        >
          send
        </button>
      </div>
    </form>
  </section>
{/if}
