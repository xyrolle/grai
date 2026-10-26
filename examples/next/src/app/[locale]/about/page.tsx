import { bindLocale } from "grai/next";
import Link from "next/link";
// Per-key paths, which package.json maps to keys.js, work beside the m namespace.
import { about_body } from "#i18n/messages/about_body.js";
import { about_title } from "#i18n/messages/about_title.js";
import * as m from "@/i18n/keys.js";
import { getLocale, locales, localizeHref } from "@/i18n/runtime.js";

export async function generateMetadata({
	params,
}: PageProps<"/[locale]/about">) {
	bindLocale((await params).locale);
	return { title: about_title() };
}

export default async function About({ params }: PageProps<"/[locale]/about">) {
	bindLocale((await params).locale);
	return (
		<main>
			<h1>{about_title()}</h1>
			<p id="body">{about_body()}</p>
			<Link id="home" href={localizeHref("/")}>
				{m.home_link()}
			</Link>
			{locales
				.filter((locale) => locale !== getLocale())
				.map((locale) => (
					<Link
						key={locale}
						id="translation"
						href={localizeHref("/about", { locale })}
					>
						{m.language_switch()}
					</Link>
				))}
		</main>
	);
}
