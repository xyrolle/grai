import { afterEach, expect, it, vi } from "vitest";
import { shownDigits } from "../src/intl-formatters.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

it("shows a value's digits by the options it is given, whatever options came before", () => {
	expect([
		shownDigits({ minimumFractionDigits: 1 }, 1),
		shownDigits({ minimumFractionDigits: 2 }, 1),
		shownDigits({ minimumFractionDigits: 1 }, 1),
		shownDigits({ style: "percent", maximumFractionDigits: 0 }, 0.5),
		shownDigits({ minimumFractionDigits: 1 }, 2.25),
	]).toEqual(["1.0", "1.00", "1.0", "50", "2.25"]);
});

it("makes one formatter for a run of digits shown with the same options, as a catalog's rounding selectors repeat them", () => {
	const made = vi.spyOn(Intl, "NumberFormat");
	const options = { minimumFractionDigits: 3, maximumFractionDigits: 3 };

	const shown = Array.from({ length: 100 }, (_, value) =>
		shownDigits(options, value),
	);

	expect(shown.at(-1)).toBe("99.000");
	expect(made).toHaveBeenCalledTimes(1);
});
