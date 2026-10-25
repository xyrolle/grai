// Where a client build puts its message chunks, and each locale's copies of them: named once for
// grai/vite, which writes them, and for the adapters that point a page at its locale's copies,
// which run on a server that must not load the build's code.

/** The directory a build's message chunks go to, within the bundler's chunk directory. */
export const messageDirectory = "grai";

/** The directory of one locale's copies of the message chunks, beside `messageDirectory`. */
export const localeDirectory = (locale: string): string => `grai-${locale}`;
