import { Cart } from "./Cart.jsx";
import { Friends } from "./Friends.jsx";
import { cartTitle, greeting, subject } from "./server.js";
import { Welcome } from "./Welcome.jsx";

export function App({ locale, name, count, sum }) {
	return (
		<main>
			<h1>{cartTitle()}</h1>
			<p>{subject(name, locale)}</p>
			<Cart count={count} sum={sum} />
			<Friends name={name} count={count} />
			<Welcome name={name} />
			<p>{greeting(name)}</p>
		</main>
	);
}
