// The charts of grai's measurements, drawn from the benches' results (bench/results/*.json), never
// by hand: each one an SVG in docs/assets in a light and a dark theme. docs/benchmarks.md shows
// every section between `<!-- charts:all -->` and `<!-- /charts:all -->`; the README shows those
// marked for it between `<!-- charts:readme -->` and `<!-- /charts:readme -->`, and the table of
// every measure at a glance between `<!-- glance -->` and `<!-- /glance -->`. Each section has
// its heading, its pictures and a table of the same numbers; a number the README's text cites
// stands between `<!-- value:<name> -->` and `<!-- /value -->`. Rerunning the benches, then
// this, updates them all.
//
// usage: node scripts/charts.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { barChart, themes } from "./charts/bars.ts";
import { cited, ratio, sections } from "./charts/figures.ts";
import type { Glance, Section } from "./charts/results.ts";

const root = new URL("../", import.meta.url);
const assets = new URL("docs/assets/", root);

/** A table as Markdown, its first row the head. */
function markdownTable([head = [], ...rows]: string[][]): string {
	const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
	return [line(head), line(head.map(() => "---")), ...rows.map(line)].join(
		"\n",
	);
}

/** A heading's anchor, as GitHub and the docs site make it. */
const anchor = (heading: string) =>
	heading
		.toLowerCase()
		.replaceAll(/[^\p{L}\p{N} _-]/gu, "")
		.replaceAll(" ", "-");

/** A page that shows charts, and how it reaches a file by its path from the repository's root. */
type Page = { file: string; fromRoot: (path: string) => string };
const readme: Page = { file: "README.md", fromRoot: (path) => path };
const benchmarks: Page = {
	file: "docs/benchmarks.md",
	fromRoot: (path) =>
		path.startsWith("docs/") ? path.slice("docs/".length) : `../${path}`,
};

/** A section as a page shows it: its heading, its lead, its pictures, then its numbers. */
function sectionMarkdown(section: Section, page: Page): string {
	const { heading, lead, figures, table, note } = section;
	const links = (text: string) =>
		text.replaceAll(
			/\]\((?![a-z]+:|#)([^)]+)\)/g,
			(_, path: string) => `](${page.fromRoot(path)})`,
		);
	const pictures = figures.map(
		({ id, alt }) => `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="${page.fromRoot(`docs/assets/${id}-dark.svg`)}">
  <img alt="${alt.replaceAll('"', "&quot;")}" src="${page.fromRoot(`docs/assets/${id}-light.svg`)}" width="480">
</picture>`,
	);
	return [
		`### ${heading}`,
		...(lead === undefined ? [] : [links(lead)]),
		pictures.join("\n\n"),
		`<details>
<summary>The numbers</summary>

${markdownTable(table)}

${links(note)}
</details>`,
	].join("\n\n");
}

/** The other's figure over grai's, as a multiple: "390×", "1.6×", "0.98×". */
function multiple(glance: Glance): string {
	const value = ratio(glance);
	const digits = value >= 10 ? 0 : value >= 1 ? 1 : 2;
	return `${value.toLocaleString("en", { maximumFractionDigits: digits, minimumFractionDigits: digits })}×`;
}

/** A figure kept on one line, its number and unit joined by a no-break space. */
const unbroken = (figure: string) => figure.replaceAll(" ", "\u00a0");

/** Every measure's row, the strongest first, each linked to its chart on the page that shows it. */
function glanceTable(all: Section[]): string {
	const rows = all
		.flatMap((section) => section.glance.map((glance) => ({ glance, section })))
		.toSorted((a, b) => ratio(b.glance) - ratio(a.glance))
		.map(({ glance, section }) => {
			const target = section.readme
				? `#${anchor(section.heading)}`
				: `docs/benchmarks.md#${anchor(section.heading)}`;
			return [
				`[${glance.measure}](${target})`,
				unbroken(glance.shown(glance.grai)),
				`${unbroken(glance.shown(glance.other.value))} (${glance.other.name})`,
				ratio(glance) >= 1 ? multiple(glance) : `${multiple(glance)}, behind`,
			];
		});
	return markdownTable([
		["Measure", "grai", "Best of the others", "Ratio"],
		...rows,
	]);
}

/** The text between a pair of markers, replaced; a marker missing from the page is an error. */
function replaced(
	text: string,
	page: Page,
	open: string,
	close: string,
	content: string,
): string {
	const start = text.indexOf(open);
	const end = text.indexOf(close, start);
	if (start === -1 || end === -1)
		throw new Error(`${page.file} has no ${open} … ${close}`);
	return `${text.slice(0, start + open.length)}\n${content}\n${text.slice(end)}`;
}

/** A page of the repository, read, changed and written again. */
function rewrite(page: Page, change: (text: string) => string) {
	const url = new URL(page.file, root);
	writeFileSync(url, change(readFileSync(url, "utf8")));
}

const all = sections();
mkdirSync(assets, { recursive: true });
for (const { figures } of all) {
	for (const { id, chart } of figures) {
		for (const [mode, theme] of Object.entries(themes)) {
			writeFileSync(
				new URL(`${id}-${mode}.svg`, assets),
				barChart(chart, theme),
			);
		}
	}
}

const values = cited();
rewrite(readme, (text) =>
	replaced(
		replaced(
			text,
			readme,
			"<!-- glance -->",
			"<!-- /glance -->",
			glanceTable(all),
		),
		readme,
		"<!-- charts:readme -->",
		"<!-- /charts:readme -->",
		all
			.filter((section) => section.readme)
			.map((section) => sectionMarkdown(section, readme))
			.join("\n\n"),
	).replaceAll(
		/<!-- value:([\w-]+) -->.*?<!-- \/value -->/g,
		(_, name: string) => {
			const value = values[name];
			if (value === undefined)
				throw new Error(
					`README.md cites a value the results have none of: ${name}`,
				);
			return `<!-- value:${name} -->${value}<!-- /value -->`;
		},
	),
);
rewrite(benchmarks, (text) =>
	replaced(
		text,
		benchmarks,
		"<!-- charts:all -->",
		"<!-- /charts:all -->",
		all.map((section) => sectionMarkdown(section, benchmarks)).join("\n\n"),
	),
);
