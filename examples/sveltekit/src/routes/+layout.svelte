<script lang="ts">
	import { reloadAcrossLocales } from "grai/sveltekit/navigation";
	import { localizeUrl } from "#lib/i18n/runtime.js";

	let { children } = $props();

	// A link to another locale's page loads that page as a document, in its locale.
	reloadAcrossLocales({ localizeUrl });
</script>

{@render children()}
