// A horizontal bar chart as an SVG, in a light or a dark theme: thin bars from one baseline with a
// 4 px rounded data-end, each named left of it and valued at its end, the interval that holds its
// median a whisker across it where it has one, one axis with its unit, and hairline gridlines.
// grai's bars take the accent and every other library's the neutral, so a bar is told by its name,
// never by its colour alone. The text is ink, never a bar's colour.

/**
 * A bar: what it names, its value on the axis, its value as written at its end, whether it is
 * grai's, and the interval that holds its median, on the axis, where its rounds give one.
 */
export type Bar = {
	label: string;
	value: number;
	shown: string;
	grai: boolean;
	interval?: { low: number; high: number };
};

/** Bars that belong together, under an optional heading. */
export type Group = { heading?: string; bars: Bar[] };

export type BarChart = {
	title: string;
	subtitle: string;
	/** The axis's unit, as its title says it: "ns a call". */
	axis: string;
	groups: Group[];
};

/**
 * The colours of a theme. The chart draws its own surface, GitHub's for the mode: `<picture>` picks
 * the SVG by the system's colour scheme, which need not be the page's, and a chart drawn on the page
 * would then put one mode's ink on the other's surface.
 */
export type Theme = {
	surface: string;
	primary: string;
	secondary: string;
	grid: string;
	baseline: string;
	accent: string;
	neutral: string;
};

/** The dataviz reference palette's ink and chrome, its slot-1 accent, and its muted gray. */
export const themes: Record<"light" | "dark", Theme> = {
	light: {
		surface: "#ffffff",
		primary: "#0b0b0b",
		secondary: "#52514e",
		grid: "#e1e0d9",
		baseline: "#c3c2b7",
		accent: "#2a78d6",
		neutral: "#898781",
	},
	dark: {
		surface: "#0d1117",
		primary: "#f0efec",
		secondary: "#c3c2b7",
		grid: "#2c2c2a",
		baseline: "#383835",
		accent: "#3987e5",
		neutral: "#898781",
	},
};

/** Narrow enough that a phone's column shrinks the type by a quarter at most. */
const width = 480;
const side = 16;
/** Room right of the longest bar for its value. */
const valueRoom = 76;
/** The room an axis's tick needs for its number, so that neighbours never touch. */
const tickRoom = 52;
/** The narrowest the bars may be drawn: a label that leaves less is too long for a chart. */
const minimumPlot = 160;
const bar = 14;
const row = 32;
const heading = 28;
const font = `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"`;
/** About the width of a character of the labels' 14 px type, to size their column by the longest. */
const characterWidth = 7.8;

/** A round step for the axis's ticks, about `ticks` of them up to the largest value. */
function tickStep(max: number, ticks: number): number {
	const rough = max / ticks;
	const power = 10 ** Math.floor(Math.log10(rough));
	const step = [1, 2, 2.5, 5, 10].find((each) => each * power >= rough) ?? 10;
	return step * power;
}

const number = (value: number) =>
	value.toLocaleString("en", { maximumFractionDigits: value < 10 ? 1 : 0 });

/** A coordinate to a tenth of a pixel, finer than a screen draws. */
const at = (value: number) => Math.round(value * 10) / 10;

/** A bar from the baseline at `x` to `x + length`, its data-end rounded. */
function barPath(x: number, y: number, length: number): string {
	const r = at(Math.min(4, length, bar / 2));
	const end = x + length;
	return `M${at(x)},${at(y)}H${at(end - r)}A${r},${r} 0 0 1 ${at(end)},${at(y + r)}V${at(y + bar - r)}A${r},${r} 0 0 1 ${at(end - r)},${at(y + bar)}H${at(x)}Z`;
}

/** An interval's whisker from `low` to `high`, capped at both ends, in ink across its bar. */
function whisker(low: number, high: number, middle: number, theme: Theme) {
	const cap = 4;
	return `<path d="M${at(low)},${at(middle)}H${at(high)}M${at(low)},${at(middle - cap)}V${at(middle + cap)}M${at(high)},${at(middle - cap)}V${at(middle + cap)}" stroke="${theme.primary}" stroke-width="1.5" fill="none"/>`;
}

const xmlText = (text: string) =>
	text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** About the width of a character of the subtitle's 13 px type, to wrap it within the chart. */
const subtitleCharacterWidth = 6.6;
/** About the width of a character of the title's 16 px bold type, to wrap it within the chart. */
const titleCharacterWidth = 8.8;

/** Text broken at spaces into lines of at most `characters` characters. A subtitle too long for one line breaks at its clauses first. */
function wrapped(text: string, characters: number): string[] {
	const lines: string[] = [];
	for (const word of text.split(" ")) {
		const last = lines.at(-1);
		if (last !== undefined && last.length + 1 + word.length <= characters)
			lines[lines.length - 1] = `${last} ${word}`;
		else lines.push(word);
	}
	return lines;
}

/** The chart in a theme, as an SVG document: each bar's name in a column left of the bars. */
export function barChart(chart: BarChart, theme: Theme): string {
	const bars = chart.groups.flatMap((group) => group.bars);
	const max = Math.max(
		...bars.map((each) => Math.max(each.value, each.interval?.high ?? 0)),
	);
	/** grai's names are bold only beside another library's, where they tell the two apart. */
	const contrasted = bars.some((each) => !each.grai);
	const longest = Math.max(...bars.map((each) => each.label.length));
	const labels = Math.ceil(longest * characterWidth) + 12;
	const x0 = side + labels;
	const plot = width - x0 - side - valueRoom;
	if (plot < minimumPlot)
		throw new Error(
			`"${chart.title}": its longest label leaves ${plot} px for the bars; shorten it`,
		);
	const step = tickStep(max, Math.min(5, Math.floor(plot / tickRoom)));
	const top = Math.ceil(max / step) * step;
	const scale = (value: number) => (value / top) * plot;
	const characters = Math.floor((width - 2 * side) / subtitleCharacterWidth);
	const subtitle =
		chart.subtitle.length <= characters
			? [chart.subtitle]
			: chart.subtitle
					.split("; ")
					.flatMap((clause, index, all) =>
						wrapped(index < all.length - 1 ? `${clause};` : clause, characters),
					);
	const parts: string[] = [];
	const title = wrapped(
		chart.title,
		Math.floor((width - 2 * side) / titleCharacterWidth),
	);
	const below = (title.length - 1) * 20;
	let y = 48 + below + subtitle.length * 17;
	const plotTop = y;
	for (const group of chart.groups) {
		if (group.heading !== undefined) {
			parts.push(
				`<text x="${side}" y="${y + 18}" font-size="13" font-weight="600" fill="${theme.secondary}">${xmlText(group.heading)}</text>`,
			);
			y += heading;
		}
		for (const each of group.bars) {
			const length = Math.max(scale(each.value), 1);
			const fill = each.grai ? theme.accent : theme.neutral;
			const middle = y + row / 2;
			const end = Math.max(length, scale(each.interval?.high ?? 0));
			parts.push(
				`<text x="${x0 - 10}" y="${middle + 5}" font-size="14" text-anchor="end" ${each.grai && contrasted ? 'font-weight="600" ' : ""}fill="${theme.primary}">${xmlText(each.label)}</text>`,
				`<path d="${barPath(x0, middle - bar / 2, length)}" fill="${fill}"/>`,
				...(each.interval === undefined
					? []
					: [
							whisker(
								x0 + scale(each.interval.low),
								x0 + scale(each.interval.high),
								middle,
								theme,
							),
						]),
				// The surface's halo keeps a gridline the value crosses out of its glyphs.
				`<text x="${at(x0 + end + 6)}" y="${middle + 5}" font-size="14" fill="${theme.primary}" stroke="${theme.surface}" stroke-width="4" stroke-linejoin="round" paint-order="stroke" style="font-variant-numeric: tabular-nums">${xmlText(each.shown)}</text>`,
			);
			y += row;
		}
	}
	const plotBottom = y + 4;
	const grid: string[] = [];
	for (let tick = 0; tick <= top + step / 2; tick += step) {
		const x = at(x0 + scale(tick));
		grid.push(
			`<line x1="${x}" y1="${plotTop}" x2="${x}" y2="${plotBottom}" stroke="${tick === 0 ? theme.baseline : theme.grid}" stroke-width="1"/>`,
			`<text x="${x}" y="${plotBottom + 17}" font-size="12" text-anchor="middle" fill="${theme.secondary}" style="font-variant-numeric: tabular-nums">${number(tick)}</text>`,
		);
	}
	const height = plotBottom + 46;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ${font}>
<title>${xmlText(chart.title)}</title>
<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6" fill="${theme.surface}" stroke="${theme.grid}"/>
${title.map((line, index) => `<text x="${side}" y="${24 + index * 20}" font-size="16" font-weight="600" fill="${theme.primary}">${xmlText(line)}</text>`).join("\n")}
${subtitle.map((line, index) => `<text x="${side}" y="${44 + below + index * 17}" font-size="13" fill="${theme.secondary}">${xmlText(line)}</text>`).join("\n")}
${grid.join("\n")}
${parts.join("\n")}
<text x="${x0 + plot}" y="${plotBottom + 37}" font-size="12" text-anchor="end" fill="${theme.secondary}">${xmlText(chart.axis)}</text>
</svg>
`;
}
