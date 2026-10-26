import { useTranslation } from "react-i18next";

export function Welcome({ name }) {
	const { t } = useTranslation(["cart", "common"], { nsMode: "fallback" });
	return (
		<p>
			{t("title")} {t("greeting", { name })}
		</p>
	);
}
