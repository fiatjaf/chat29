<script lang="ts">
  import {page} from '$app/stores'

  $: code = $page.url.pathname.slice(1)
</script>

<h1 class="my-4 text-lg">room {code}</h1>
<p>messages</p>
