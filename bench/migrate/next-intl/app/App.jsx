import { Home, Nav } from "./Home.jsx";

export function App({ name, count }) {
	return (
		<>
			<Nav />
			<Home name={name} count={count} />
		</>
	);
}
