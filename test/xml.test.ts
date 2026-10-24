import { describe, expect, it } from "vitest";
import { readXml, type XmlElement, XmlError } from "../src/xml-reader.ts";
import { escapeAttribute, escapeText } from "../src/xml-text.ts";

describe("the XML reader", () => {
	it("reads elements, attributes in either quote, references, CDATA and comments", () => {
		const root = readXml(
			`﻿<?xml version="1.0" encoding="UTF-8"?>
<!-- before -->
<a x='1' y="&quot;&#10;&lt;">t &amp; &#x41;<![CDATA[<raw> & ]]><!-- inside --><b/></a>
`,
		);

		expect(root).toEqual({
			name: "a",
			attributes: new Map([
				["x", "1"],
				["y", '"\n<'],
			]),
			children: [
				"t & A<raw> & ",
				{ name: "b", attributes: new Map(), children: [] },
			],
		});
	});

	it("refuses a DTD, a reference it does not know, a tag left open or closed by another, and text after the root", () => {
		for (const document of [
			'<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>',
			"<a>&nbsp;</a>",
			"<a>&#0;</a>",
			"<a>a & b</a>",
			"<a><b></a>",
			"<a><b>",
			"<a/>text",
			'<a x="1" x="2"/>',
			"<a x=1/>",
			"",
		]) {
			expect(() => readXml(document), document).toThrow(XmlError);
		}
	});

	it("reads back the text and attributes it writes, whitespace and all", () => {
		const text = "a & <b> ]]> \"c\" 'd'\r\n\te";
		const root: XmlElement = readXml(
			`<a v="${escapeAttribute(text)}">${escapeText(text)}</a>`,
		);

		expect([root.attributes.get("v"), root.children[0]]).toEqual([text, text]);
	});
});
