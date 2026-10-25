import { useTranslation } from "react-i18next";

export function Cart({ count, sum }) {
	const { t } = useTranslation("cart");
	return (
		<section>
			<h2>{t("title")}</h2>
			<p>{t("items", { count })}</p>
			<Summary sum={sum} />
		</section>
	);
}

function Summary({ sum }) {
	const [t] = useTranslation(["cart", "common"], { keyPrefix: "summary" });
	return (
		<footer>
			{t("total", { sum })} {t("empty")}
		</footer>
	);
}
