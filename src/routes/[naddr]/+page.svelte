<script lang="ts">
  import type {Event} from 'nostr-tools/pure'
  import type {AbstractRelay, Subscription} from 'nostr-tools/abstract-relay'
  import * as nip19 from 'nostr-tools/nip19'
  import {onMount} from 'svelte'
  import {debounce} from 'debounce'

  import {afterNavigate} from '$app/navigation'
  import {page} from '$app/stores'

  import {account} from '../../lib/nostr.ts'
  import {pool, publish} from '../../lib/nostr.ts'
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
  $: isMember = !!members.find(m => m.pubkey === $account?.pubkey)
  $: isAdmin = !!admins.find(m => m.pubkey === $account?.pubkey)

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
          {kinds: [39000, 39001, 39002], '#d': [identifier]},
          {
            kinds: [9005],
            '#h': [identifier],
            limit: 0,
            since: Math.round(Date.now() / 1000)
          }
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
              case 9005:
              case 5:
                for (let i = 0; i < event.tags.length; i++) {
                  let tag = event.tags[i]
                  if (tag.length < 2 || tag[0] !== 'e') continue
                  let id = tag[1]
                  let idx = messages.findIndex(m => m.id === id)
                  if (idx !== -1) {
                    messages.splice(idx, 1)
                  }
                }
                messages = messages
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
      console.warn('failed to ask to join', err)
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
      console.warn('failed to send', err)
      showToast({type: 'error', text: String(err)})
      isSending = false
    }
  }

  async function deleteMessage(ev: MouseEvent) {
    const id = (ev.currentTarget as HTMLElement).dataset.id
    if (typeof id === 'string' && confirm('really delete this message?')) {
      try {
        publish(
          {
            kind: isAdmin ? 9005 : 5,
            content: '',
            tags: [
              ['h', group!.id],
              ['e', id]
            ],
            created_at: Math.round(Date.now() / 1000)
          },
          relay.url
        )
      } catch (err) {
        console.warn('failed to delete', err)
        showToast({type: 'error', text: String(err)})
      }
    }
  }

  async function banMember(ev: CustomEvent) {
    const member: Member = ev.detail.member
    if (member && confirm('really ban this user?')) {
      try {
        publish(
          {
            kind: 9001,
            content: '',
            tags: [
              ['h', group!.id],
              ['p', member.pubkey]
            ],
            created_at: Math.round(Date.now() / 1000)
          },
          relay.url
        )
        showToast({
          type: 'success',
          text: 'successfully banned ' + member.pubkey
        })
      } catch (err) {
        console.warn('failed to ban', err)
        showToast({type: 'error', text: String(err)})
      }
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

<div
  class="h-full grid gap-2"
  style:grid-template-areas={`
    "header header"
    "chat members"
  `}
  style:grid-template-rows="fit-content(20%) auto"
  style:grid-template-columns="auto fit-content(10%)"
>
  <header class="pb-3 h-full bg-white" style:grid-area="header">
    <Header />
    <div class="flex items-center justify-end mt-4">
      <div class="text-sm">room</div>
      <div class="text-emerald-600 text-lg mx-4 overflow-hidden text-ellipsis">
        {group?.name || groupRawName || $page.params.naddr}
      </div>
      <div class="text-xs text-stone-400">
        {groupRawName}
      </div>
    </div>
  </header>
  <aside style:grid-area="members">
    <div class="pl-4">
      <h3 class="text-lg text-emerald-600">admins</h3>
      {#each admins as admin}
        <MemberLabel member={admin} />
      {/each}
      <h3 class="pt-2 text-lg text-emerald-600">members</h3>
      {#each members as member}
        <MemberLabel
          {member}
          canBan={isAdmin && member.pubkey !== $account?.pubkey}
          on:ban={banMember}
        />
      {/each}
    </div>
  </aside>
  <main
    style:grid-area="chat"
    class="grid h-full"
    style:grid-template-rows="75vh min-content"
  >
    <section class="row-span-9 overflow-y-auto pr-4">
      <div class="flex flex-col h-full">
        <div class="h-full overflow-x-hidden overflow-y-auto">
          {#each messages as message (message.id)}
            <div
              class="grid gap-2 items-center hover:bg-emerald-100 group"
              style:grid-template-columns="120px auto 99px"
              id={`evt-${message.id.substring(-6)}`}
            >
              <div class="self-end">
                <UserLabel pubkey={message.pubkey} />
              </div>
              <div class="break-all">
                {message.content}
              </div>
              <div class="flex justify-end text-stone-400 text-xs pr-1">
                {#if message.created_at > Date.now() / 1000 - 60 * 60 * 3 && (isAdmin || message.pubkey === $account?.pubkey)}
                  <!-- svelte-ignore a11y-no-static-element-interactions a11y-missing-attribute -->
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <a
                    class="hover:text-red-600 cursor-pointer"
                    on:click={deleteMessage}
                    data-id={message.id}
                    title="delete message"
                  >
                    ×
                  </a>
                  &nbsp;
                {/if}
                <span title={new Date(message.created_at * 1000).toString()}>
                  {humanDate(message.created_at)}
                </span>
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
      {:else if group?.public && $account}
        <div class="m-8 w-full">
          <button
            class="p-8 h-full w-full text-2xl bg-blue-500 hover:bg-blue-400 text-white rounded transition-colors"
            on:click={askToJoin}
            disabled={isSending}>join</button
          >
        </div>
      {:else}
        <p class="p-6 text-center border border-stone-200 m-2">
          you are not a member of this group
        </p>
      {/if}
    </section>
  </main>
</div>
