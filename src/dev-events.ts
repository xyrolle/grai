// The names the dev module and the framework adapters share in the page. Plain strings, so a
// browser module imports them without the compiler that writes the dev module.

/** The custom HMR event that carries an edit's patch. */
export const updateEvent = "grai:update";
/** The event the page dispatches after it writes an edit's patch: `detail.keys` are the edited keys. */
export const changeEvent = "grai:change";
/**
 * The event a server's module runner sends once it has written an edit's patch, which the plugin
 * passes on to the page: the page's loads then run again on a server that has the edit.
 */
export const patchedEvent = "grai:patched";
/** The global, as `Symbol.for(readHook)`, a framework adapter sets to hear each message call by its key. */
export const readHook = "grai.read";
