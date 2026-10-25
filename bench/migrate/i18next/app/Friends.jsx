import { useTranslation } from "react-i18next";

export function Friends({ name, count }) {
	const { t } = useTranslation("common");
	return (
		<ul>
			<li>{t("greeting", { name })}</li>
			<li>{t("friend")}</li>
			<li>{t("friend", { context: "male" })}</li>
			<li>{t("friend", { context: "female" })}</li>
			<li>{t("place", { count, ordinal: true })}</li>
		</ul>
	);
}
