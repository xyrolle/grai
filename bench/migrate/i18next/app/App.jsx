import { Cart } from "./Cart.jsx";
import { Friends } from "./Friends.jsx";
import { cartTitle, subject } from "./server.js";

export function App({ locale, name, count, sum }) {
	return (
		<main>
			<h1>{cartTitle()}</h1>
			<p>{subject(name, locale)}</p>
			<Cart count={count} sum={sum} />
			<Friends name={name} count={count} />
		</main>
	);
}
