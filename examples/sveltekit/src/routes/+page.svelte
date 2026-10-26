<script lang="ts">
	import { onMount } from "svelte";
	import { m } from "#lib/i18n/messages.js";
	import { locales, localizeHref } from "#lib/i18n/runtime.js";

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
</script>

<h1>{m.greeting()}</h1>
<a href={localizeHref("/about")}>{m.nav_about()}</a>
<nav>
	{#each locales as locale (locale)}
		<a href={localizeHref("/", { locale })} hreflang={locale}>{locale}</a>
	{/each}
</nav>
{#if hydrated}
	<p>{m.drawn_in_browser()}</p>
{/if}
