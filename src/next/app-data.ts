/** What withGrai hands the threads it starts in `next dev`: the grai config's path, and Next's page extensions. */
export type AppData = { configFile: string; pageExtensions: string[] };

/** Whether a thread's data is an app's, as the thread reads it from `workerData`. */
export function isAppData(data: unknown): data is AppData {
	return (
		typeof data === "object" &&
		data !== null &&
		"configFile" in data &&
		typeof data.configFile === "string" &&
		"pageExtensions" in data &&
		Array.isArray(data.pageExtensions) &&
		data.pageExtensions.every((extension) => typeof extension === "string")
	);
}
