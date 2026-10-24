import { execFile } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { project } from "./project.ts";

const tsc = fileURLToPath(new URL("../node_modules/.bin/tsc", import.meta.url));
const types = fileURLToPath(new URL("../node_modules/@types", import.meta.url));

it.each([
	["the base locale only", {}],
	[
		"cookie and URL strategies",
		{ strategy: ["cookie", "url"], cookieName: "lang" },
	],
])(
	"writes JavaScript that TypeScript checks under checkJs and strict, with %s",
	async (_, config) => {
		const { dir, compile } = project(
			{
				en: {
					cart_title: "Your cart",
					cart_greeting: "Hello {name}",
					cart_items: [
						{
							declarations: ["input count", "local plural = count: plural"],
							selectors: ["plural"],
							match: {
								"plural=one": "{count} item",
								"plural=*": "{count} items",
							},
						},
					],
					cart_delivery: [
						{
							declarations: ["input speed"],
							selectors: ["speed"],
							match: {
								"speed=fast": "Fast delivery",
								"speed=slow": "Slow delivery",
							},
						},
					],
					cart_terms: "Read the {#link}terms{/link}",
					cart_total: "Total {amount :number style=currency currency=EUR}",
					cart_shipped: "Shipped {when :date}",
					cart_guests: "With {names :list}, {days :relativetime unit=day}",
					cart_place: [
						{
							declarations: [
								"input n",
								"local nOrdinal = n: plural type=ordinal",
							],
							selectors: ["nOrdinal"],
							match: {
								"nOrdinal=one": "{n}st in line",
								"nOrdinal=*": "{n}th in line",
							},
						},
					],
					cart_left: [
						{
							declarations: ["input count", "local n = count: integer"],
							selectors: ["n"],
							match: {
								"n=0": "None left",
								"n=one": "One left",
								"n=*": "{n} left",
							},
						},
					],
				},
				ar: {
					cart_title: "سلة التسوق",
					cart_greeting: "مرحبا {name}",
					cart_items: [
						{
							declarations: ["input count", "local plural = count: plural"],
							selectors: ["plural"],
							match: {
								"plural=zero": "لا عناصر",
								"plural=one": "عنصر واحد",
								"plural=two": "عنصران",
								"plural=few": "{count} عناصر",
								"plural=many": "{count} عنصرا",
								"plural=*": "{count} عنصر",
							},
						},
					],
					cart_delivery: [
						{
							declarations: ["input speed"],
							selectors: ["speed"],
							match: { "speed=fast": "توصيل سريع", "speed=slow": "توصيل بطيء" },
						},
					],
					cart_terms: "اقرأ {#link}الشروط{/link}",
					cart_total: "المجموع {amount :number style=currency currency=EUR}",
					cart_shipped: "شحن {when :date}",
					cart_guests: "مع {names :list}، {days :relativetime unit=day}",
					cart_place: [
						{
							declarations: [
								"input n",
								"local nOrdinal = n: plural type=ordinal",
							],
							selectors: ["nOrdinal"],
							match: { "nOrdinal=*": "الترتيب {n}" },
						},
					],
					cart_left: [
						{
							declarations: ["input count", "local n = count: integer"],
							selectors: ["n"],
							match: { "n=0": "لم يبق شيء", "n=*": "بقي {n}" },
						},
					],
				},
			},
			{ outdir: "src/lib/i18n", ...config },
		);
		expect((await compile()).errors).toEqual([]);
		const output = join(dir, "src", "lib", "i18n");
		// Every file listed, as a checker that takes each JavaScript file on its own does: a listed
		// file is checked even beside a declaration file of its name.
		const files = readdirSync(output, { recursive: true, encoding: "utf8" })
			.filter((file) => /\.(js|d\.ts)$/.test(file))
			.map((file) => join(output, file));
		writeFileSync(join(dir, "package.json"), '{ "type": "module" }');
		writeFileSync(
			join(dir, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					allowJs: true,
					checkJs: true,
					strict: true,
					noUncheckedIndexedAccess: true,
					exactOptionalPropertyTypes: true,
					verbatimModuleSyntax: true,
					noEmit: true,
					module: "esnext",
					moduleResolution: "bundler",
					target: "esnext",
					lib: ["esnext", "dom"],
					typeRoots: [types],
					types: ["node"],
				},
				files,
			}),
		);

		const checked = await promisify(execFile)(tsc, ["-p", dir]).then(
			({ stdout }) => stdout,
			(error: { stdout: string }) => error.stdout,
		);

		expect(checked).toBe("");
	},
);
