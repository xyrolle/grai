import { expect, it } from "vitest";
import { messageBindings } from "../src/message-imports.ts";

it("lists a destructured dynamic import once, as the one import it is", () => {
	const text = `const { cart_title } = await import("#i18n/messages/cart_title.js");\nconst late = import("#i18n/messages/cart_total.js");\n`;

	expect(
		messageBindings(text, new Set(["m"])).statements.map(
			({ binds, specifier }) => ({ binds, specifier: specifier.text }),
		),
	).toEqual([
		{ binds: true, specifier: "#i18n/messages/cart_title.js" },
		{ binds: false, specifier: "#i18n/messages/cart_total.js" },
	]);
});
