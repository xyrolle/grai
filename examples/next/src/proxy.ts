export { proxy } from "grai/next/proxy";

export const config = {
	// Every page, but not Next's own files, API routes or files with an extension.
	matcher: ["/((?!api|_next|.*\\..*).*)"],
};
