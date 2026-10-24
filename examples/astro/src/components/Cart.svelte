<script lang="ts">
import { onMount } from "svelte";
import { m } from "#lib/i18n/messages.js";

let count = $state(1);
let hydrated = $state(false);
onMount(() => {
	hydrated = true;
});
</script>

<p id="cart">{m.cart_items({ count })}</p>
<button type="button" disabled={!hydrated} onclick={() => count++}>{m.cart_add()}</button>
{#if hydrated}
	<p id="svelte">{m.drawn_by_svelte()}</p>
{/if}
