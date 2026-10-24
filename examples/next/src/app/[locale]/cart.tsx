"use client";
import { useState } from "react";
import { m } from "@/i18n/messages.js";

export function Cart() {
	const [count, setCount] = useState(1);
	return (
		<p>
			<span id="cart">{m.cart_items({ count })}</span>{" "}
			<button type="button" onClick={() => setCount(count + 1)}>
				{m.cart_add()}
			</button>
		</p>
	);
}
