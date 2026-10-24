"use client";
import { m } from "@/i18n/messages.js";
import { getLocale, locales, setLocale } from "@/i18n/runtime.js";

export function LanguageSwitch() {
	const other = locales.find((locale) => locale !== getLocale()) ?? getLocale();
	return (
		<button id="language" type="button" onClick={() => setLocale(other)}>
			{m.language_switch()}
		</button>
	);
}
