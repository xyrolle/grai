import { useTranslations } from "next-intl";

export function Home({ name, count }) {
	const t = useTranslations("Home");
	return (
		<main>
			<h1>{t("title")}</h1>
			<p>{t("greeting", { name })}</p>
			<p>{t("items", { count })}</p>
			<p>{t("ranked", { place: count })}</p>
		</main>
	);
}

export function Nav() {
	const t = useTranslations();
	return <nav>{t("About.title")}</nav>;
}
