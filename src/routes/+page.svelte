<script lang="ts">
  import {afterNavigate, goto} from '$app/navigation'

  import SelectPage from '../pages/SelectPage.svelte'

  // opening the app at `/` jumps straight back into the last visited
  // group — but only once per tab: reaching `/` from inside the app
  // (e.g. the header logo) or reloading it afterwards must show the
  // selection page, otherwise there is no way to switch relays
  afterNavigate(nav => {
    if (nav.from !== null) return
    if (sessionStorage.getItem('autoResumed')) return
    const last = localStorage.getItem('lastGroupCode')
    if (last) {
      sessionStorage.setItem('autoResumed', '1')
      goto('/' + last, {replaceState: true})
    }
  })
</script>

<SelectPage />
