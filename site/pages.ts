// The site's pages, written from the repo's own docs before each build, so each fact has one
// source: the README's sections, and the docs a section points to. A link to another page's source
// becomes that page's route; a link to any other file of the repo goes to it on GitHub. The charts
// in docs/assets are served from the site's own public directory.
//
// usage: node pages.ts
import {
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const repo = new URL("../", import.meta.url);
const pagesDir = new URL("src/content/docs/", import.meta.url);
const assetsDir = new URL("public/assets/", import.meta.url);
const github = "https://github.com/xyrolle/grai/blob/main/";

/** A page: its route, its title, and where its text comes from. */
type Page = {
	route: string;
	title: string;
	/** A file of the repo, whole but its first heading; or the README's sections with these titles. */
	from: string | readonly string[];
};

const pages: readonly Page[] = [
	{ route: "", title: "grai", from: ["", "Why grai", "Quick start"] },
	{ route: "guide", title: "Guide", from: "docs/guide.md" },
	{ route: "frameworks", title: "Frameworks", from: "docs/frameworks.md" },
	{ route: "config", title: "Config", from: "docs/config.md" },
	{ route: "api", title: "API", from: "docs/api.md" },
	{
		route: "migrating",
		title: "Migrating",
		from: ["Coming from Paraglide or i18next"],
	},
	{
		route: "migrating/paraglide",
		title: "From Paraglide",
		from: "docs/migrating-from-paraglide.md",
	},
	{
		route: "migrating/i18next",
		title: "From i18next, next-intl or FormatJS",
		from: "docs/migrating.md",
	},
	{ route: "measured", title: "Measured", from: "docs/benchmarks.md" },
	{ route: "limitations", title: "Limitations", from: "docs/limitations.md" },
];

function read(file: string): string {
	return readFileSync(new URL(file, repo), "utf8");
}

/** The README's sections by their `##` titles, the text before the first one under "". */
function readmeSections(): Map<string, string> {
	const sections = new Map<string, string>();
	const parts = read("README.md")
		.replace(/^# .*\n/, "")
		.split(/^## (.*)\n/m);
	sections.set("", parts[0] ?? "");
	for (let n = 1; n < parts.length; n += 2) {
		sections.set(parts[n] ?? "", parts[n + 1] ?? "");
	}
	return sections;
}

/** A page's text from the README: the first section's text as it is, each other under its title. */
function fromReadme(
	sections: Map<string, string>,
	titles: readonly string[],
): string {
	return titles
		.map((title, n) => {
			const text = sections.get(title);
			if (text === undefined)
				throw new Error(`README.md has no section "${title}"`);
			return n === 0 ? text : `## ${title}\n${text}`;
		})
		.join("\n");
}

/** Where each page's own file is in the repo, by its route: the README's pages have none. */
const routeOf = new Map(
	pages.flatMap((page) =>
		typeof page.from === "string" ? [[page.from, page.route]] : [],
	),
);

/**
 * The text's relative links, each to the page its target is or else to the file on GitHub, and
 * its pictures' sources, each to the site's copy of docs/assets.
 */
function rewriteLinks(text: string, source: string): string {
	return text
		.replace(
			/\]\((?![a-z]+:|#)([^)#\s]+)(#[^)\s]*)?\)/g,
			(_, target: string, anchor = "") => {
				const file = posix.normalize(posix.join(posix.dirname(source), target));
				const route = routeOf.get(file);
				return route === undefined
					? `](${github}${file}${anchor})`
					: `](/${route}/${anchor})`;
			},
		)
		.replace(
			/\b(src|srcset)="(?![a-z]+:|\/)([^"]+)"/g,
			(_, attribute: string, target: string) => {
				const file = posix.normalize(posix.join(posix.dirname(source), target));
				if (!file.startsWith("docs/assets/"))
					throw new Error(
						`${source} shows ${file}, which is not in docs/assets`,
					);
				return `${attribute}="/${file.slice("docs/".length)}"`;
			},
		);
}

rmSync(pagesDir, { recursive: true, force: true });
rmSync(assetsDir, { recursive: true, force: true });
cpSync(new URL("docs/assets/", repo), assetsDir, { recursive: true });
const sections = readmeSections();
for (const page of pages) {
	const source = typeof page.from === "string" ? page.from : "README.md";
	const text =
		typeof page.from === "string"
			? read(page.from).replace(/^# .*\n/, "")
			: fromReadme(sections, page.from);
	const file = join(fileURLToPath(pagesDir), `${page.route || "index"}.md`);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(
		file,
		`---\ntitle: ${JSON.stringify(page.title)}\n---\n${rewriteLinks(text, source)}`,
	);
}
