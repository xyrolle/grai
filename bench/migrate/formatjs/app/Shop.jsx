import { FormattedMessage, useIntl } from "react-intl";

export function Shop({ name, count, sum, status }) {
	const intl = useIntl();
	return (
		<main
			aria-label={intl.formatMessage({
				id: "shop.title",
				defaultMessage: "Shop",
			})}
		>
			<h1>
				<FormattedMessage id="shop.greeting" values={{ name }} />
			</h1>
			<Cart count={count} sum={sum} />
			{status !== undefined && (
				<FormattedMessage
					id="order.status"
					values={{ status }}
					description="Where the order is"
				/>
			)}
		</main>
	);
}

function Cart({ count, sum }) {
	const { formatMessage } = useIntl();
	return (
		<section>
			<p>{formatMessage({ id: "cart.items" }, { count })}</p>
			<p title={formatMessage({ id: "cart.total" }, { sum })}>
				<FormattedMessage id="cart.total" values={{ sum }} />
			</p>
		</section>
	);
}
