import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";

// grai's docs site: the README's sections and the docs they point to, as pages.ts writes them.
// The links validator fails the build on a link to a page or a heading that is not there.
export default defineConfig({
	integrations: [
		starlight({
			title: "grai",
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/xyrolle/grai",
				},
			],
			plugins: [starlightLinksValidator()],
			sidebar: [
				{ label: "Getting started", link: "/" },
				"config",
				"api",
				{
					label: "Migrating",
					items: ["migrating", "migrating/paraglide", "migrating/i18next"],
				},
				"measured",
				"limitations",
			],
		}),
	],
});
