import { bindLocale } from "@xyrolle/grai/next";
import { Markup } from "@xyrolle/grai/react";
import Link from "next/link";
import * as m from "@/i18n/keys.js";
import { localizeHref } from "@/i18n/runtime.js";
import { Cart } from "./cart.tsx";
import { LanguageSwitch } from "./language-switch.tsx";

export default async function Home({ params }: PageProps<"/[locale]">) {
	bindLocale((await params).locale);
	return (
		<main>
			<h1>{m.title()}</h1>
			<p id="greeting">{m.greeting({ name: "Ana" })}</p>
			<Cart />
			<p id="terms">
				<Markup
					parts={m.terms.parts()}
					markup={{
						link: (children, { options }) => (
							<a href={String(options.href)}>{children}</a>
						),
					}}
				/>
			</p>
			<Link id="about" href={localizeHref("/about")}>
				{m.about_link()}
			</Link>{" "}
			<Link href={localizeHref("/delivery")}>{m.delivery_link()}</Link>
			<LanguageSwitch />
		</main>
	);
}
