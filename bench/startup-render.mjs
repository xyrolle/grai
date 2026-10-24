// How the startup bench renders its sample with each kind of module, the same in a Node process
// and in workerd: `t(key, values)` for i18next and use-intl, a key's function for grai and
// Paraglide, with the locale named in each call where the module holds every locale.

/** How each kind of module renders one call. */
const callers = {
	t: (loaded) => (key, values) => loaded.t(key, values),
	module: (loaded) => (key, values) => loaded[key](values),
	options: (loaded, locale) => {
		const options = { locale };
		return (key, values) => loaded[key](values, options);
	},
};

/** A function that renders every call of the sample with `loaded` in `locale`, and gives the text. */
export function sampleRender(loaded, mode, calls, locale) {
	const call = callers[mode](loaded, locale);
	const render = () => {
		let text = "";
		for (const { key, values } of calls) text += call(key, values);
		return text;
	};
	return () =>
		loaded.withLocale ? loaded.withLocale(locale, render) : render();
}
