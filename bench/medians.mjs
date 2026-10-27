// Medians with an interval that assumes nothing of the times' spread: the median lies between two
// order statistics of the sample with a confidence a binomial gives, so the interval holds for a
// skewed spread with outliers, as start times on a busy machine have.

/** The median: the middle value, or the mean of the middle two. */
export function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	return sorted.length % 2 === 1
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The chance that a fair coin tossed `n` times shows heads exactly `k` times. */
function binomial(n, k) {
	let chance = 0.5 ** n;
	for (let index = 1; index <= k; index++) chance *= (n - k + index) / index;
	return chance;
}

/**
 * The narrowest interval of order statistics that holds the median with at least 95% confidence,
 * and that confidence: the k-th lowest and k-th highest value, for the largest k whose chance of
 * fewer than k values below the median is at most 2.5% on either side. With fewer than nine values,
 * the lowest and the highest, and the confidence they give.
 */
export function medianInterval(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const n = sorted.length;
	let k = 1;
	let below = binomial(n, 0);
	while (below + binomial(n, k) <= 0.025) {
		below += binomial(n, k);
		k++;
	}
	return { low: sorted[k - 1], high: sorted[n - k], confidence: 1 - 2 * below };
}
