<script lang="ts">
  import type {Event} from 'nostr-tools/pure'
  import type {AbstractRelay, Subscription} from 'nostr-tools/abstract-relay'
  import * as nip19 from 'nostr-tools/nip19'
  import {onMount} from 'svelte'
  import {debounce} from 'debounce'

  import {afterNavigate} from '$app/navigation'
  import {page} from '$app/stores'
  import {pool, publish, signer} from '../../lib/nostr.ts'
  import {showToast, humanDate} from '../../lib/utils.ts'
  import {
    parseGroup,
    parseMembers,
    type Group,
    type Member
  } from '../../lib/group.ts'
  import UserLabel from '../../components/UserLabel.svelte'
  import Header from '../../components/Header.svelte'
  import MemberLabel from '../../components/MemberLabel.svelte'

  let pubkey: string
  let naddr = $page.params.naddr
  let messages: Event[] = []
  let text = localStorage.getItem('text') || ''
  let isSending = false
  let controlIsDown = false
  let shiftIsDown = false
  let group: Group | null = null
  let admins: Member[] = []
  let members: Member[] = []
  let info: {pubkey: string; name: string; description: string; icon: string}
  let relay: AbstractRelay
  let sub: Subscription
  let eoseHappened = false

  $: groupRawName = relay ? `${group?.id}@${new URL(relay.url).host}` : ''
  $: isMember = members.find(m => m.pubkey === pubkey)

  const updateMessages = debounce(() => {
    messages = messages
    scrollToEnd()
  }, 300)

  const saveToLocalStorage = debounce(() => {
    localStorage.setItem('text', text)
  }, 2000)

  function scrollToEnd() {
    if (messages.length > 3) {
      setTimeout(() => {
        document
          .getElementById(
            `evt-${messages[messages.length - 1].id.substring(-6)}`
          )
          ?.scrollIntoView()
      }, 25)
    }
  }

  onMount(() => {
    signer.getPublicKey().then(pk => {
      pubkey = pk
    })
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
    group = null
  }

  async function loadChat() {
    naddr = $page.params.naddr

    try {
      let {data, type} = nip19.decode(naddr)
      if (type !== 'naddr') return

      let {relays, identifier} = data as nip19.AddressPointer
      if (!relays || relays.length === 0) return

      let relayUrl = relays![0]
      group = {id: identifier}

      relay = await pool.ensureRelay(relayUrl)
      info = await fetch(relayUrl.replace('ws', 'http'), {
        headers: {accept: 'application/nostr+json'}
      }).then(r => r.json())

      sub = relay.subscribe(
        [
          {kinds: [9], '#h': [identifier], limit: 700},
          {kinds: [39000, 39001, 39002], '#d': [identifier]}
        ],
        {
          onevent(event) {
            switch (event.kind) {
              case 39000:
                group = parseGroup(event)
                break
              case 39001:
                admins = parseMembers(event)
                break
              case 39002:
                members = parseMembers(event)
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
      showToast({type: 'error', text: err.message})
    }
  }

  async function askToJoin() {
    try {
      isSending = true
      await publish(
        {
          kind: 9021,
          content: '',
          tags: [['h', group!.id]],
          created_at: Math.round(Date.now() / 1000)
        },
        relay.url
      )
      text = ''
      saveToLocalStorage()
      isSending = false
    } catch (err) {
      console.log('failed to send', err)
      showToast({type: 'error', text: String(err)})
      isSending = false
    }
  }

  async function sendMessage() {
    try {
      isSending = true
      await publish(
        {
          kind: 9,
          content: text,
          tags: [['h', group!.id]],
          created_at: Math.round(Date.now() / 1000)
        },
        relay.url
      )
      text = ''
      saveToLocalStorage()
      isSending = false
    } catch (err) {
      console.log('failed to send', err)
      showToast({type: 'error', text: String(err)})
      isSending = false
    }
  }

  function onKeyDown(ev: KeyboardEvent) {
    if (ev.repeat) return
    switch (ev.key) {
      case 'Shift':
        shiftIsDown = true
        ev.preventDefault()
        break
      case 'Control':
        controlIsDown = true
        ev.preventDefault()
        break
      case 'Enter':
        if (!controlIsDown && !shiftIsDown) {
          ev.preventDefault()
          sendMessage()
        }
        break
    }
  }

  function onKeyUp(ev: KeyboardEvent) {
    switch (ev.key) {
      case 'Shift':
        shiftIsDown = false
        ev.preventDefault()
        break
      case 'Control':
        controlIsDown = false
        ev.preventDefault()
        break
    }
  }
</script>

<svelte:window on:keydown={onKeyDown} on:keyup={onKeyUp} />

<div class="grid grid-cols-1 lg:grid-cols-7 h-full">
  <main
    class="grid col-span-1 lg:col-span-6 h-full"
    style="grid-template-rows: 6vh 80vh 9vh;"
  >
    <header class="pb-8">
      <Header />
      <div class="flex items-center">
        <div class="text-sm">room</div>
        <div
          class="text-emerald-600 text-lg mx-4 overflow-hidden text-ellipsis"
        >
          {group?.name || groupRawName || $page.params.naddr}
        </div>
        <div class="text-xs text-stone-400">
          {groupRawName}
        </div>
      </div>
    </header>
    <section class="row-span-9 overflow-y-auto pr-4">
      <div class="flex flex-col h-full">
        <div class="h-full overflow-auto">
          {#each messages as message}
            <div
              class="grid gap-2 items-center hover:bg-emerald-100"
              style="grid-template-columns: fit-content(10%) auto fit-content(10%)"
              id={`evt-${message.id.substring(-6)}`}
            >
              <div>
                <UserLabel pubkey={message.pubkey} />
              </div>
              <div>
                {message.content}
              </div>
              <div
                class="flex justify-end text-stone-400 text-xs"
                title={new Date(message.created_at * 1000).toString()}
              >
                {humanDate(message.created_at)}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </section>
    <section>
      {#if isMember}
        <form
          on:submit={sendMessage}
          class="grid grid-cols-7 pt-4 mb-2 h-full py-4"
        >
          <textarea
            class="h-full w-full bg-stone-100 col-span-6"
            class:bg-stone-100={isSending}
            placeholder={isSending
              ? 'submitting...'
              : !isMember
              ? 'you are not a member of this group'
              : 'type a message here (press Enter to send)'}
            bind:value={text}
            on:input={saveToLocalStorage}
            readonly={isSending}
          />
          <div class="col-span-1 pl-2">
            <button
              class="h-full w-full px-4 py-2 text-white rounded transition-colors"
              class:bg-blue-500={!isSending}
              class:hover:bg-blue-400={!isSending}
              class:bg-stone-400={isSending}
              disabled={isSending || !group?.id || !relay}
            >
              send
            </button>
          </div>
        </form>
      {:else if group?.public}
        <div class="m-8 w-full">
          <button
            class="p-8 h-full w-full text-2xl bg-blue-500 hover:bg-blue-400 text-white rounded transition-colors"
            on:click={askToJoin}
            disabled={isSending}>join</button
          >
        </div>
      {:else}
        <p class="p-8">you are not a member of this group</p>
      {/if}
    </section>
  </main>
  <aside class="col-span-0 hidden lg:block lg:col-span-1">
    <h2 class="text-center pt-2 pb-4 text-xl text-emerald-800">members</h2>
    <div class="pl-4">
      <h3 class="text-lg">admins</h3>
      {#each admins as admin}
        <MemberLabel member={admin} />
      {/each}
      <h3 class="pt-2 text-lg">members</h3>
      {#each members as member}
        <MemberLabel {member} />
      {/each}
    </div>
  </aside>
</div>
