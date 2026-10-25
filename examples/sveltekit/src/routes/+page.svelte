<script lang="ts">
	import { onMount } from "svelte";
	import { m } from "#lib/i18n/messages.js";
	import { localizeHref } from "#lib/i18n/runtime.js";

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
</script>

<h1>{m.greeting()}</h1>
<a href={localizeHref("/about")}>{m.nav_about()}</a>
{#if hydrated}
	<p>{m.drawn_in_browser()}</p>
{/if}
