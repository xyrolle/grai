// The README's charts, drawn from the benches' results (bench/results/*.json), never by hand: each
// one as an SVG in docs/assets in a light and a dark theme, and each section of the README between
// `<!-- charts:<id> -->` and `<!-- /charts:<id> -->` written again with its pictures and a table of
// the same numbers. A number the text cites stands between `<!-- value:<name> -->` and
// `<!-- /value -->`. Rerunning the benches, then this, updates them all.
//
// usage: node scripts/charts.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { barChart, themes } from "./charts/bars.ts";
import { cited, type Section, sections } from "./charts/figures.ts";

const root = new URL("../", import.meta.url);
const assets = new URL("docs/assets/", root);

/** A table as Markdown, its first row the head. */
function markdownTable([head = [], ...rows]: string[][]): string {
	const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
	return [line(head), line(head.map(() => "---")), ...rows.map(line)].join(
		"\n",
	);
}

/** A section's pictures, each GitHub's light or dark one by the reader's scheme, then its numbers. */
function sectionMarkdown({ lead, figures, table, note }: Section): string {
	const pictures = figures.map(
		({ id, alt }) => `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/${id}-dark.svg">
  <img alt="${alt.replaceAll('"', "&quot;")}" src="docs/assets/${id}-light.svg" width="480">
</picture>`,
	);
	return `${lead === undefined ? "" : `${lead}\n\n`}${pictures.join("\n\n")}

<details>
<summary>The numbers</summary>

${markdownTable(table)}

${note}
</details>`;
}

/** The text between a section's markers, replaced; a marker missing from the README is an error. */
function replaced(
	text: string,
	open: string,
	close: string,
	content: string,
): string {
	const start = text.indexOf(open);
	const end = text.indexOf(close, start);
	if (start === -1 || end === -1)
		throw new Error(`README.md has no ${open} … ${close}`);
	return `${text.slice(0, start + open.length)}\n${content}\n${text.slice(end)}`;
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

const readmeFile = new URL("README.md", root);
let readme = readFileSync(readmeFile, "utf8");
for (const section of all) {
	readme = replaced(
		readme,
		`<!-- charts:${section.id} -->`,
		`<!-- /charts:${section.id} -->`,
		sectionMarkdown(section),
	);
}
readme = readme.replaceAll(
	/<!-- value:([\w-]+) -->.*?<!-- \/value -->/g,
	(_, name: string) => {
		const value = values[name];
		if (value === undefined)
			throw new Error(
				`README.md cites a value the results have none of: ${name}`,
			);
		return `<!-- value:${name} -->${value}<!-- /value -->`;
	},
);
writeFileSync(readmeFile, readme);
