import type { RoutingSeat } from "./router.ts";
import type { SeatName } from "./seats.ts";
import type { UsageWindow } from "./usage.ts";

interface Numbers {
	readonly live: number;
	readonly fiveHour: number | "unknown";
	readonly sevenDay: number | "unknown";
}
const window = (utilization: number | "unknown"): UsageWindow | "unknown" => {
	if (utilization === "unknown") {
		return "unknown";
	}
	return { resetAt: "unknown", utilization };
};
const defaults: Numbers = { fiveHour: 10, live: 0, sevenDay: 1 };
const row = (
	seat: SeatName,
	values: Readonly<Partial<Numbers>> = {},
): RoutingSeat => {
	const { live, fiveHour, sevenDay } = { ...defaults, ...values };
	return {
		live,
		seat,
		usage: {
			fiveHour: window(fiveHour),
			sevenDay: window(sevenDay),
		},
	};
};
const now = 100_000;
const healthy = [row("main"), row("dev"), row("dev2"), row("dev3")];

export { healthy, now, row };
