import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { type ImportFormat, importCatalogs } from "../src/import.ts";
import { compile } from "../src/index.ts";
import { migrate } from "../src/migrate.ts";
import { readText, writeSources } from "./sources.ts";

/**
 * A project for `locales`, the first its base, whose source catalogs, by path under `source/`, are
 * imported, and whose files, by path from its root, are then migrated under `src/`.
 */
function migrated(
	format: ImportFormat,
	catalogs: Record<string, unknown>,
	files: Record<string, string>,
	locales = ["en", "de"],
) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "grai-migrate-")));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	const config = join(dir, "grai.config.json");
	writeSources(dir, {
		"grai.config.json": JSON.stringify({
			locales,
			baseLocale: locales[0],
			catalogs: "messages/{locale}.json",
			outdir: "out",
		}),
		...Object.fromEntries(
			Object.entries(catalogs).map(([path, catalog]) => [
				`source/${path}`,
				JSON.stringify(catalog),
			]),
		),
		...files,
	});
	mkdirSync(join(dir, "src"), { recursive: true });
	const imported = importCatalogs(config, format, [join(dir, "source")]);
	expect(imported.errors.map((error) => error.message)).toEqual([]);
	const result = migrate(config, [join(dir, "src")]);
	return {
		dir,
		result,
		text: (path: string) => readText(dir, path),
		/** Each call left for a person, as the CLI prints it. */
		left: () =>
			result.left.map(
				({ file, line, column, detail }) =>
					`${file}:${line}:${column}: ${detail}`,
			),
		/** Compiles the catalogs, then imports a migrated module. */
		load: async (path: string): Promise<Record<string, Exported>> => {
			const compiled = await compile(config);
			expect(compiled.errors.map((error) => error.message)).toEqual([]);
			return import(pathToFileURL(join(dir, path)).href);
		},
	};
}

/** What a migrated module exports, as the tests call it. */
type Exported = ((...args: unknown[]) => unknown) | undefined;

const i18nextCatalogs = {
	"en/common.json": {
		greeting: "Hello, {{name}}",
		place_ordinal_one: "{{count}}st",
		place_ordinal_two: "{{count}}nd",
		place_ordinal_few: "{{count}}rd",
		place_ordinal_other: "{{count}}th",
		friend: "A friend",
		friend_male: "A boyfriend",
	},
	"en/cart.json": {
		title: "Cart",
		items_one: "{{count}} item",
		items_other: "{{count}} items",
		summary: { total: "Total: {{sum}}" },
	},
	"de/common.json": {
		greeting: "Hallo, {{name}}",
		place_ordinal_other: "{{count}}.",
		friend: "Ein Freund",
		friend_male: "Ein fester Freund",
	},
	"de/cart.json": {
		title: "Warenkorb",
		items_one: "{{count}} Artikel",
		items_other: "{{count}} Artikel",
		summary: { total: "Summe: {{sum}}" },
	},
};

describe("grai migrate, from i18next", () => {
	it("rewrites useTranslation's t with its namespace and keyPrefix, and removes what it leaves unused", () => {
		const project = migrated("i18next", i18nextCatalogs, {
			"src/cart.tsx": `import { useTranslation } from "react-i18next";

export function Cart({ count }: { count: number }) {
	const { t } = useTranslation("cart");
	return (
		<p title={t("title")}>
			{t("items", { count })} {t("common:friend", { context: "male" })}
		</p>
	);
}

export function Total({ sum }: { sum: string }) {
	const [t] = useTranslation(["cart", "common"], { keyPrefix: "summary" });
	return <b>{t("total", { sum })}</b>;
}
`,
		});

		expect(project.result.changed).toEqual(["src/cart.tsx"]);
		expect(project.left()).toEqual([]);
		expect(
			project.text("src/cart.tsx"),
		).toBe(`import { m } from "../out/messages.js";

export function Cart({ count }: { count: number }) {
	return (
		<p title={m.cart_title()}>
			{m.cart_items({ count })} {m.common_friend_male()}
		</p>
	);
}

export function Total({ sum }: { sum: string }) {
	return <b>{m.cart_summary_total({ sum })}</b>;
}
`);
	});

	it("drops a t it rewrote every call of from React's hook dependencies, and keeps one it did not", () => {
		const project = migrated("i18next", i18nextCatalogs, {
			"src/title.tsx": `import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export function Title({ count }: { count: number }) {
	const { t } = useTranslation("cart");
	const title = useMemo(() => t("title"), [t]);
	const items = useMemo(() => t("items", { count }), [count, t]);
	return <h1 title={items}>{title}</h1>;
}

export function Note({ keyName }: { keyName: string }) {
	const { t } = useTranslation("cart");
	return useMemo(() => t(keyName), [t, keyName]);
}
`,
		});

		expect(
			project.text("src/title.tsx"),
		).toBe(`import { m } from "../out/messages.js";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export function Title({ count }: { count: number }) {
	const title = useMemo(() => m.cart_title(), []);
	const items = useMemo(() => m.cart_items({ count }), [count]);
	return <h1 title={items}>{title}</h1>;
}

export function Note({ keyName }: { keyName: string }) {
	const { t } = useTranslation("cart");
	return useMemo(() => t(keyName), [t, keyName]);
}
`);
		expect(project.left()).toEqual([
			"src/title.tsx:13:23: its key is an expression: call the message by name, as m.<key>().",
		]);
	});

	it("rewrites i18next's own t, with ns, ordinal and lng, into calls that render as i18next did", async () => {
		const project = migrated("i18next", i18nextCatalogs, {
			"src/server.ts": `import i18next, { t } from "i18next";

export const greet = (name: string) => t("common:greeting", { name });
export const place = (count: number, lng: string) =>
	i18next.t("place", { ns: "common", count, ordinal: true, lng });
`,
			"src/language.ts": `import i18next from "i18next";

export const title = () => i18next.t("cart:title");
export const language = () => i18next.language;
`,
		});
		const server = await project.load("src/server.ts");

		expect(
			project.text("src/server.ts"),
		).toBe(`import { m } from "../out/messages.js";

export const greet = (name: string) => m.common_greeting({ name });
export const place = (count: number, lng: string) =>
	m.common_place_ordinal({ count }, { locale: lng });
`);
		expect(
			project.text("src/language.ts"),
		).toBe(`import { m } from "../out/messages.js";
import i18next from "i18next";

export const title = () => m.cart_title();
export const language = () => i18next.language;
`);
		expect(project.left()).toEqual([
			"src/language.ts:4:31: i18next.language is i18next's own: replace it by hand, with grai's runtime where it has a counterpart.",
		]);
		expect([2, 3, 11].map((count) => server.place?.(count, "en"))).toEqual([
			"2nd",
			"3rd",
			"11th",
		]);
		expect(server.place?.(2, "de")).toBe("2.");
	});

	it("follows each t to the hook that declares it, past a name that shadows it, and changes nothing the next time", () => {
		const project = migrated("i18next", i18nextCatalogs, {
			"src/cards.tsx": `import { useTranslation } from "react-i18next";

const label = "Корзина 🛒";

export function Cart() {
	const { t } = useTranslation("cart");
	return <h1 title={label}>{t("title")}</h1>;
}

export function Greeting({ name }: { name: string }) {
	const { t } = useTranslation("common");
	const shout = (t: string) => t.toUpperCase();
	return <p>{shout(t("greeting", { name }))}</p>;
}
`,
		});
		const migratedText = `import { m } from "../out/messages.js";

const label = "Корзина 🛒";

export function Cart() {
	return <h1 title={label}>{m.cart_title()}</h1>;
}

export function Greeting({ name }: { name: string }) {
	const shout = (t: string) => t.toUpperCase();
	return <p>{shout(m.common_greeting({ name }))}</p>;
}
`;

		expect(project.text("src/cards.tsx")).toBe(migratedText);
		expect(project.left()).toEqual([]);
		const again = migrate(join(project.dir, "grai.config.json"));
		expect([again.changed, again.left]).toEqual([[], []]);
		expect(project.text("src/cards.tsx")).toBe(migratedText);
	});

	it("reports each call it cannot rewrite with its line, and keeps what those calls need", () => {
		const project = migrated("i18next", i18nextCatalogs, {
			"src/left.tsx": `import { Trans, useTranslation } from "react-i18next";

export function Left({ name, gender, keyName, options }) {
	const { t } = useTranslation("common");
	return (
		<>
			{t(keyName)}
			{t(\`friend_\${gender}\`)}
			{t("friend", { context: gender })}
			{t("greeting")}
			{t("greeting", options)}
			{t("missing")}
			{t("greeting", { name })}
			<Trans i18nKey="common:greeting" values={{ name }} components={{ b: <b /> }} />
			<Child t={t} />
		</>
	);
}

export function Prefixed() {
	const { t } = useTranslation("cart", { keyPrefix: "summary" });
	return <p>{t("common:greeting")}</p>;
}
`,
		});

		expect(project.left()).toEqual([
			"src/left.tsx:7:5: its key is an expression: call the message by name, as m.<key>().",
			"src/left.tsx:8:5: its key is an expression: call the message by name, as m.<key>().",
			"src/left.tsx:9:5: its context is an expression: call each context's key by name.",
			"src/left.tsx:10:5: the message reads name, which the call does not pass.",
			"src/left.tsx:11:5: its options are not an object written in the call, so what they pass is unknown.",
			"src/left.tsx:12:5: grai.import.json has no key common:missing: the import left it out, or no catalog has it.",
			"src/left.tsx:14:4: <Trans> renders markup and components: render the message's .parts() instead.",
			"src/left.tsx:15:14: t is passed on, so where it is called cannot be followed: call the messages by name there.",
			"src/left.tsx:22:13: its key names a namespace under a keyPrefix, where i18next does not find it: call the message by name, as m.<key>().",
		]);
		expect(
			project.text("src/left.tsx"),
		).toBe(`import { m } from "../out/messages.js";
import { Trans, useTranslation } from "react-i18next";

export function Left({ name, gender, keyName, options }) {
	const { t } = useTranslation("common");
	return (
		<>
			{t(keyName)}
			{t(\`friend_\${gender}\`)}
			{t("friend", { context: gender })}
			{t("greeting")}
			{t("greeting", options)}
			{t("missing")}
			{m.common_greeting({ name })}
			<Trans i18nKey="common:greeting" values={{ name }} components={{ b: <b /> }} />
			<Child t={t} />
		</>
	);
}

export function Prefixed() {
	const { t } = useTranslation("cart", { keyPrefix: "summary" });
	return <p>{t("common:greeting")}</p>;
}
`);
	});
});

const icuCatalogs = {
	"en.json": {
		Home: {
			title: "Welcome",
			greeting: "Hello, {name}",
			items: "{count, plural, one {# item} other {# items}}",
		},
		About: { title: "About us", intro: "Read <b>this</b>" },
	},
	"de.json": {
		Home: {
			title: "Willkommen",
			greeting: "Hallo, {name}",
			items: "{count, plural, one {# Artikel} other {# Artikel}}",
		},
		About: { title: "Über uns", intro: "Lies <b>das</b>" },
	},
};

describe("grai migrate, from next-intl", () => {
	it("rewrites the t of useTranslations and getTranslations under their namespace, with getTranslations' locale", async () => {
		const project = migrated("icu", icuCatalogs, {
			"src/home.tsx": `import { useTranslations } from "next-intl";

export function Home({ name, count }: { name: string; count: number }) {
	const t = useTranslations("Home");
	return (
		<main>
			<h1>{t("title")}</h1>
			<p>{t("greeting", { name })}</p>
			<p>{t("items", { count })}</p>
		</main>
	);
}
`,
			"src/about.ts": `import { getTranslations } from "next-intl/server";

export async function aboutTitle(locale: string) {
	const t = await getTranslations({ locale, namespace: "About" });
	return t("title");
}

export async function homeTitle() {
	const t = await getTranslations();
	return t("Home.title");
}
`,
		});
		const about = await project.load("src/about.ts");

		expect(project.left()).toEqual([]);
		expect(
			project.text("src/home.tsx"),
		).toBe(`import { m } from "../out/messages.js";

export function Home({ name, count }: { name: string; count: number }) {
	return (
		<main>
			<h1>{m.Home_title()}</h1>
			<p>{m.Home_greeting({ name })}</p>
			<p>{m.Home_items({ count })}</p>
		</main>
	);
}
`);
		expect(
			project.text("src/about.ts"),
		).toBe(`import { m } from "../out/messages.js";

export async function aboutTitle(locale: string) {
	return m.About_title({}, { locale });
}

export async function homeTitle() {
	return m.Home_title();
}
`);
		expect(
			await Promise.all([about.aboutTitle?.("de"), about.homeTitle?.()]),
		).toEqual(["Über uns", "Welcome"]);
	});

	it("reports t.rich, t.raw, a message with markup and a namespace that is an expression", () => {
		const project = migrated("icu", icuCatalogs, {
			"src/about.tsx": `import { useTranslations } from "next-intl";

export function About({ section }: { section: string }) {
	const t = useTranslations("About");
	const s = useTranslations(section);
	return (
		<>
			{t.rich("intro", { b: (chunks) => <b>{chunks}</b> })}
			{t("intro")}
			{t.raw("title")}
			{s("title")}
		</>
	);
}
`,
		});

		expect(project.left()).toEqual([
			"src/about.tsx:8:5: t.rich renders markup: render the message's .parts() instead.",
			"src/about.tsx:9:5: the message has markup: render its .parts() instead.",
			"src/about.tsx:10:5: t.raw is next-intl's own: grai's messages are functions, never raw text.",
			"src/about.tsx:11:5: its namespace is an expression: call the message by name, as m.<key>().",
		]);
		expect(project.result.changed).toEqual([]);
	});
});

const formatjsCatalogs = {
	"en.json": {
		"app.title": "Shop",
		"app.greeting": "Hello, {name}",
		"cart.items": "{count, plural, one {# item} other {# items}}",
		"app.intro": "Read <b>this</b>",
	},
	"de.json": {
		"app.title": "Laden",
		"app.greeting": "Hallo, {name}",
		"cart.items": "{count, plural, one {# Artikel} other {# Artikel}}",
		"app.intro": "Lies <b>das</b>",
	},
};

describe("grai migrate, from FormatJS", () => {
	it("rewrites formatMessage of useIntl, its object's or destructured, and <FormattedMessage> as an expression", () => {
		const project = migrated("icu", formatjsCatalogs, {
			"src/shop.tsx": `import { FormattedMessage, useIntl } from "react-intl";

export function Shop({ name, count }: { name: string; count: number }) {
	const intl = useIntl();
	const { formatMessage } = useIntl();
	return (
		<section aria-label={intl.formatMessage({ id: "app.title", defaultMessage: "Shop" })}>
			<FormattedMessage id="app.greeting" values={{ name }} />
			<p>{formatMessage({ id: "cart.items" }, { count })}</p>
			{count > 0 && <FormattedMessage id="cart.items" values={{ count }} description="badge" />}
		</section>
	);
}
`,
		});

		expect(project.left()).toEqual([]);
		expect(
			project.text("src/shop.tsx"),
		).toBe(`import { m } from "../out/messages.js";

export function Shop({ name, count }: { name: string; count: number }) {
	return (
		<section aria-label={m.app_title()}>
			{m.app_greeting({ name })}
			<p>{m.cart_items({ count })}</p>
			{count > 0 && m.cart_items({ count })}
		</section>
	);
}
`);
	});

	it("reports descriptors not written in the call, rich values, and the rest of the library", () => {
		const project = migrated("icu", formatjsCatalogs, {
			"src/left.tsx": `import { FormattedMessage, useIntl } from "react-intl";
import { messages } from "./messages";

export function Left({ id }: { id: string }) {
	const intl = useIntl();
	return (
		<>
			{intl.formatMessage(messages.title)}
			<FormattedMessage id={id} />
			<FormattedMessage {...messages.title} />
			<FormattedMessage id="app.intro" values={{ b: (chunks) => <b>{chunks}</b> }} />
			{intl.formatNumber(5)}
		</>
	);
}
`,
		});

		expect(project.left()).toEqual([
			"src/left.tsx:8:5: its descriptor is not an object written in the call: write { id } in the call, or call the message by name.",
			"src/left.tsx:9:4: its id is an expression: call the message by name, as m.<key>().",
			"src/left.tsx:10:4: its descriptor is not an object written in the call: write { id } in the call, or call the message by name.",
			"src/left.tsx:11:4: the message has markup: render its .parts() instead.",
			"src/left.tsx:12:5: intl.formatNumber is react-intl's own: replace it by hand, with grai's runtime where it has a counterpart.",
		]);
		expect(project.result.changed).toEqual([]);
	});
});

describe("grai migrate", () => {
	it("reports a component it does not parse and a module whose m is another name, and changes neither", () => {
		const project = migrated("i18next", i18nextCatalogs, {
			"src/Cart.svelte": `<script>
	import { t } from "i18next";
</script>

<h1>{t("cart:title")}</h1>
`,
			"src/math.ts": `import { t } from "i18next";

const m = 2;
export const title = () => t("cart:title") + m;
`,
		});

		expect(project.left()).toEqual([
			"src/Cart.svelte:2:2: grai migrate rewrites JavaScript and TypeScript modules: migrate this component's calls by hand.",
			"src/math.ts:4:28: m names something else here: rename it, then run grai migrate again.",
		]);
		expect(project.result.changed).toEqual([]);
	});

	it("is an error without the import's mapping, and changes nothing", () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "grai-migrate-")));
		onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
		writeSources(dir, {
			"grai.config.json": JSON.stringify({
				locales: ["en"],
				baseLocale: "en",
				catalogs: "messages/{locale}.json",
				outdir: "out",
			}),
			"src/a.ts": 'import { t } from "i18next";\nt("a");\n',
		});

		const result = migrate(join(dir, "grai.config.json"));

		expect(result.errors.map((error) => error.message)).toEqual([
			"grai.import.json: there is no mapping of the import's keys. Run grai import first: it writes this file.",
		]);
		expect(readText(dir, "src/a.ts")).toBe(
			'import { t } from "i18next";\nt("a");\n',
		);
	});
});
