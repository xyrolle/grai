<script setup lang="ts">
import * as m from "~/i18n/keys.js";

// The page waits before it renders, as a page that loads its data does, so a server renders
// requests side by side, each in its own locale.
const days = await new Promise<number>((resolve) => setTimeout(resolve, 10, 3));
const title = m.delivery_title();
</script>

<template>
	<main>
		<h1>{{ title }}</h1>
		<p id="estimate">{{ m.delivery_estimate({ days }) }}</p>
	</main>
</template>
