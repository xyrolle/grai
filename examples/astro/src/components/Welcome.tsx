import { useEffect, useState } from "react";
import { m } from "#lib/i18n/messages.js";

export default function Welcome({ name }: { name: string }) {
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => setHydrated(true), []);
	return (
		<>
			<p id="welcome">{m.welcome({ name })}</p>
			{hydrated && <p id="react">{m.drawn_by_react()}</p>}
		</>
	);
}
