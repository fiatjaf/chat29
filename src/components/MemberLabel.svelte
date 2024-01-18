<script lang="ts">
  import type {Member} from '../lib/group.ts'
  import UserLabel from './UserLabel.svelte'

  export let member: Member
</script>

<div>
  <UserLabel pubkey={member.pubkey} />
</div>
