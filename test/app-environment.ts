/**
 * The environment an example's own commands run in, as a developer's shell gives it: without the
 * markers Vitest sets, which tools read as running inside a test. Under them Vite builds Vue for
 * development rather than production.
 */
export function outsideTests(
	extra: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
	const environment = { ...process.env };
	for (const name of Object.keys(environment)) {
		if (name === "NODE_ENV" || name === "TEST" || name.startsWith("VITEST"))
			delete environment[name];
	}
	return { ...environment, ...extra };
}
