import i18next, { t } from "i18next";

export function subject(name, lng) {
	return i18next.t("common:greeting", { name, lng });
}

export function cartTitle() {
	return t("title", { ns: "cart" });
}

export function greeting(name) {
	return t("greeting", { ns: ["cart", "common"], name });
}
