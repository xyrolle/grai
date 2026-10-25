// What each call of the sample passes, as each library takes it, and how a message with markup is
// drawn: grai's and Paraglide's parts and use-intl's tags all as the same tags in the text, so
// every library's text can be checked against the others'. Plain data in and no imports, so a
// page builds it too.

/** A message's parts drawn as text, each element as a tag. */
export function show(parts) {
	let text = "";
	for (const part of parts) {
		if (part.type === "text") text += part.value;
		else if (part.type === "markup-start") text += `<${part.name}>`;
		else if (part.type === "markup-end") text += `</${part.name}>`;
		else text += `<${part.name}></${part.name}>`;
	}
	return text;
}

/** use-intl's function for a tag, drawing it as `show` draws an element. */
const tag = (name) => (chunks) => `<${name}>${chunks}</${name}>`;

/**
 * What the calls pass, by position: their inputs; with `options`, the locale for a forced call;
 * with `i18next`, i18next's values; with `useIntl`, use-intl's, a function for each of its tags
 * beside the inputs. `calls` carry `inputs`, `i18next` and `markup`, the names of their tags.
 */
export function callValues(calls, locale) {
	return Object.assign(
		calls.map((call) => call.inputs),
		{
			options: { locale },
			i18next: calls.map((call) => call.i18next),
			useIntl: calls.map((call) => ({
				...call.inputs,
				...Object.fromEntries(call.markup.map((name) => [name, tag(name)])),
			})),
		},
	);
}
