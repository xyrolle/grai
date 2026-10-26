import { expect, it } from "vitest";
import { shownDigits } from "../src/intl-formatters.ts";

it("shows a value's digits by the options it is given, whatever options came before", () => {
	expect([
		shownDigits({ minimumFractionDigits: 1 }, 1),
		shownDigits({ minimumFractionDigits: 2 }, 1),
		shownDigits({ minimumFractionDigits: 1 }, 1),
		shownDigits({ style: "percent", maximumFractionDigits: 0 }, 0.5),
		shownDigits({ minimumFractionDigits: 1 }, 2.25),
	]).toEqual(["1.0", "1.00", "1.0", "50", "2.25"]);
});
