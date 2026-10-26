"use client";
import * as m from "@/i18n/keys.js";
import { getLocale, locales, setLocale } from "@/i18n/runtime.js";

export function LanguageSwitch() {
	const other = locales.find((locale) => locale !== getLocale()) ?? getLocale();
	return (
		<button id="language" type="button" onClick={() => setLocale(other)}>
			{m.language_switch()}
		</button>
	);
}
