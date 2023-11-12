<script lang="ts">
  import '../app.postcss';
</script>

<svelte:head>
  <title>chat29</title>
</svelte:head>

<div class="m-4">
  <h1 class="text-2xl">
    chat29 <span class="text-xs"
      >- <a
        href="https://github.com/nostr-protocol/nips/blob/simple-chat-groups/29.md"
        class="text-blue-500 underline"
        target="_blank">NIP-29</a
      >-based barebones chat client.
    </span>
  </h1>
  <slot />
</div>
