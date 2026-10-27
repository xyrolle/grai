import { bindLocale, LocaleProvider } from "@xyrolle/grai/next";
import { getTextDirection, locales } from "@/i18n/runtime.js";

export function generateStaticParams() {
	return locales.map((locale) => ({ locale }));
}

export default async function RootLayout({
	children,
	params,
}: LayoutProps<"/[locale]">) {
	const { locale } = await params;
	bindLocale(locale);
	return (
		<html lang={locale} dir={getTextDirection()}>
			<body>
				<LocaleProvider locale={locale}>{children}</LocaleProvider>
			</body>
		</html>
	);
}
