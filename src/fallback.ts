import type { ProbeResult } from "./claude-probe.ts";
import type { RoutingSeat } from "./router.ts";
import { usageStatus } from "./router.ts";
import type { SeatName } from "./seats.ts";

interface Cooldown {
	readonly seat: SeatName;
	readonly until: number;
}
interface FallbackState {
	readonly cooldowns: readonly Cooldown[];
	readonly lastSeat: SeatName | "none";
}
type SeatProbe = (seat: SeatName) => ProbeResult | Promise<ProbeResult>;
interface PreparedFallback {
	readonly rows: readonly RoutingSeat[];
	readonly state: FallbackState;
}
const resolveSeat = async (
	row: RoutingSeat,
	cooldowns: readonly Cooldown[],
	probe: SeatProbe | false,
): Promise<RoutingSeat> => {
	const cooldown = cooldowns.find((entry) => entry.seat === row.seat);
	if (cooldown) {
		return {
			...row,
			availability: { kind: "cooldown", until: cooldown.until },
		};
	}
	if (
		probe === false ||
		row.probe !== true ||
		usageStatus(row.usage) !== "unknown"
	) {
		return row;
	}
	try {
		return { ...row, availability: await probe(row.seat) };
	} catch {
		return { ...row, availability: { kind: "unavailable" } };
	}
};
const prepareFallback = async (
	seats: readonly RoutingSeat[],
	state: FallbackState,
	{ probe, now }: Readonly<{ probe: SeatProbe; now: number }>,
): Promise<PreparedFallback> => {
	const active = state.cooldowns.filter((entry) => entry.until > now);
	const healthy = seats.some(
		(row) =>
			usageStatus(row.usage) === "healthy" &&
			!active.some((entry) => entry.seat === row.seat),
	);
	let needed: SeatProbe | false = probe;
	if (healthy) {
		needed = false;
	}
	const rows = await Promise.all(
		seats.map(async (row) => resolveSeat(row, active, needed)),
	);
	const cooldowns = rows.flatMap((row): readonly Cooldown[] => {
		const availability = row.availability ?? { kind: "unavailable" };
		if (availability.kind === "cooldown") {
			return [{ seat: row.seat, until: availability.until }];
		}
		return [];
	});
	return { rows, state: { cooldowns, lastSeat: state.lastSeat } };
};

export type { Cooldown, FallbackState, SeatProbe };
export { prepareFallback };
