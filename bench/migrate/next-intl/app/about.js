import { getTranslations } from "next-intl/server";

export async function aboutTitle() {
	const t = await getTranslations("About");
	return t("title");
}

export async function visits(locale, count) {
	const t = await getTranslations({ locale, namespace: "About" });
	return t("visits", { count });
}
