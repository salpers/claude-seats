import type { ProbeResult } from "./claude-probe.ts";
import type { SeatProbe } from "./fallback.ts";
import { prepareFallback } from "./fallback.ts";
import { readFallbackState } from "./fallback-state.ts";
import type { RoutingSeat } from "./router.ts";
import type { DecisionOptions } from "./routing-audit.ts";
import type { SeatName } from "./seats.ts";

interface LockedOptions {
	readonly manual?: SeatName | undefined;
	readonly probe?: SeatProbe | undefined;
	readonly resume?: DecisionOptions["resume"];
}
const prepareRoutingProbes = async (
	directory: string,
	readSeats: () => readonly RoutingSeat[] | Promise<readonly RoutingSeat[]>,
	options: LockedOptions,
): Promise<LockedOptions | false> => {
	if (!options.probe || options.manual) {
		return options;
	}
	const stored = await readFallbackState(directory);
	if (!stored.ok) {
		return false;
	}
	const results = new Map<SeatName, ProbeResult>();
	const { probe } = options;
	await prepareFallback(await readSeats(), stored.state, {
		now: Date.now(),
		probe: async (seat: SeatName): Promise<ProbeResult> => {
			const result = await probe(seat);
			results.set(seat, result);
			return result;
		},
	});
	// Re-read counts and fallback state under the lock; never reuse the old cursor or cooldowns.
	return {
		...options,
		probe: (seat: SeatName): ProbeResult =>
			results.get(seat) ?? { kind: "unavailable" },
	};
};

export type { LockedOptions };
export { prepareRoutingProbes };
