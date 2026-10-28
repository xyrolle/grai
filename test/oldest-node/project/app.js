// A key's path, which package.json maps to keys.js, as Node loads it with grai's hooks registered:
// the module of that key alone.
const title = await import("#i18n/messages/title.js");
const { m } = await import("./out/messages.js");
console.log(
	JSON.stringify({
		exports: Object.keys(title),
		title: title.title(),
		items: m.items({ count: 2 }),
	}),
);
