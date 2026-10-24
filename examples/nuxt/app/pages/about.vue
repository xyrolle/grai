<script setup lang="ts">
import { useHead } from "#imports";
import * as m from "~/i18n/keys.js";
import { localizeHref } from "~/i18n/runtime.js";

useHead({ title: m.about_title() });
</script>

<template>
	<main>
		<h1>{{ m.about_title() }}</h1>
		<p>{{ m.about_body() }}</p>
		<NuxtLink id="home" :to="localizeHref('/')">{{ m.home_link() }}</NuxtLink>
	</main>
</template>
