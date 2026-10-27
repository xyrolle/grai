<script setup lang="ts">
import { Markup } from "@xyrolle/grai/vue";
import { h, onMounted, ref } from "vue";
// A namespace import, which Vue's compiler takes as a constant: the template then calls each
// message itself, and the build keeps only the messages it calls (docs/design.md).
import * as m from "./i18n/keys.js";
import { getLocale, locales, setLocale } from "./i18n/runtime.js";

const count = ref(1);
const other = locales.find((locale) => locale !== getLocale()) ?? getLocale();
const hydrated = ref(false);
onMounted(() => {
	hydrated.value = true;
});
</script>

<template>
	<main>
		<h1>{{ m.title() }}</h1>
		<p id="greeting">{{ m.greeting({ name: "Ana" }) }}</p>
		<p>
			<span id="cart">{{ m.cart_items({ count }) }}</span>
			<button type="button" @click="count += 1">{{ m.cart_add() }}</button>
		</p>
		<p id="terms">
			<Markup
				:parts="m.terms.parts()"
				:markup="{ link: (children) => h('a', { href: '/terms' }, children) }"
			/>
		</p>
		<button id="language" type="button" @click="setLocale(other)">
			{{ m.language_switch() }}
		</button>
		<p v-if="hydrated" id="hydrated">{{ m.drawn_in_browser() }}</p>
	</main>
</template>
