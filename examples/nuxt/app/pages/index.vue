<script setup lang="ts">
import { Markup } from "grai/vue";
import { h, onMounted, ref } from "vue";
import * as m from "~/i18n/keys.js";
import { getLocale, locales, localizeHref } from "~/i18n/runtime.js";

const count = ref(1);
// Each locale's name in its own language, so a link into a locale needs none of its messages.
const others = locales
	.filter((locale) => locale !== getLocale())
	.map((locale) => ({
		locale,
		name: new Intl.DisplayNames([locale], { type: "language" }).of(locale),
	}));
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
		<NuxtLink id="about" :to="localizeHref('/about')">{{ m.about_link() }}</NuxtLink>
		<NuxtLink id="delivery" :to="localizeHref('/delivery')">{{ m.delivery_link() }}</NuxtLink>
		<nav>
			<NuxtLink
				v-for="other in others"
				:key="other.locale"
				:to="localizeHref('/', { locale: other.locale })"
				:hreflang="other.locale"
			>
				{{ other.name }}
			</NuxtLink>
		</nav>
		<p v-if="hydrated" id="hydrated">{{ m.drawn_in_browser() }}</p>
	</main>
</template>
