import { bindLocale } from "@xyrolle/grai/next";
import { connection } from "next/server";
import * as m from "@/i18n/keys.js";
import { Cart } from "../cart.tsx";

/** Reads the estimate, as from a carrier's API: the render awaits it, and other requests run meanwhile. */
async function Estimate() {
	const days = await new Promise<number>((settle) =>
		setTimeout(() => settle(3), 20),
	);
	return <p id="estimate">{m.delivery_estimate({ days })}</p>;
}

// Rendered for each request, not ahead of time, so requests in different locales interleave.
export default async function Delivery({
	params,
}: PageProps<"/[locale]/delivery">) {
	await connection();
	bindLocale((await params).locale);
	return (
		<main>
			<h1>{m.delivery_title()}</h1>
			<Estimate />
			<Cart />
		</main>
	);
}
