import type { ProbeResult } from "./claude-probe.ts";
import type { SeatName } from "./seats.ts";
import type { Usage, UsageWindow } from "./usage.ts";

interface Claim {
	readonly seat: SeatName;
	readonly createdAt: number;
}
interface RoutingSeat {
	readonly seat: SeatName;
	readonly live: number;
	readonly usage: Usage | "unknown";
	readonly probe?: boolean;
	readonly availability?: ProbeResult;
}
interface RoutingRow {
	readonly seat: SeatName;
	readonly live: number;
	readonly claims: number;
	readonly fiveHour: number | "unknown";
	readonly sevenDay: number | "unknown";
	readonly status:
		| "healthy"
		| "exhausted"
		| "unknown"
		| "probed"
		| "cooldown"
		| "unavailable";
	readonly cooldownUntil?: number;
}
interface Decision {
	readonly seat: SeatName;
	readonly mode: "auto" | "manual";
	readonly reason:
		| "manual"
		| "all seats exhausted"
		| "usage unavailable"
		| typeof fallbackReason
		| typeof rankingReason;
	readonly rows: readonly RoutingRow[];
}
interface RoutingOptions {
	readonly now: number;
	readonly manual?: SeatName | undefined;
	readonly lastFallbackSeat?: SeatName;
}
const claimLifetimeMs = 10_000;
const exhausted = 100;
const nearLimit = 90;
const zero = 0;
const one = 1;
const rankingReason =
	"fewest live sessions + claims; below 90% 5h first; lowest 7d; registry order";
const fallbackReason = "fallback: fewest live sessions + claims; round-robin";
const activeClaim = (claim: Claim, now: number): boolean =>
	claim.createdAt <= now && now - claim.createdAt < claimLifetimeMs;
const utilization = (window: UsageWindow | "unknown"): number | "unknown" => {
	if (window === "unknown") {
		return "unknown";
	}
	return window.utilization;
};
const status = (
	fiveHour: number | "unknown",
	sevenDay: number | "unknown",
): RoutingRow["status"] => {
	if (
		(typeof fiveHour === "number" && fiveHour >= exhausted) ||
		(typeof sevenDay === "number" && sevenDay >= exhausted)
	) {
		return "exhausted";
	}
	if (fiveHour === "unknown" && sevenDay === "unknown") {
		return "unknown";
	}
	return "healthy";
};
const usageStatus = (usage: Usage | "unknown"): RoutingRow["status"] => {
	if (usage === "unknown") {
		return "unknown";
	}
	return status(utilization(usage.fiveHour), utilization(usage.sevenDay));
};
const probeStatus = (row: RoutingSeat): RoutingRow["status"] => {
	const availability = row.availability ?? { kind: "unavailable" };
	if (availability.kind === "available") {
		return "probed";
	}
	if (row.probe === false) {
		return "unavailable";
	}
	return "unknown";
};
const availabilityStatus = (
	row: RoutingSeat,
	now: number,
): RoutingRow["status"] => {
	const availability = row.availability ?? { kind: "unavailable" };
	if (availability.kind === "cooldown" && availability.until > now) {
		return "cooldown";
	}
	const known = usageStatus(row.usage);
	if (known !== "unknown") {
		return known;
	}
	return probeStatus(row);
};

const cooldownFor = (
	row: RoutingSeat,
	now: number,
): Readonly<{ cooldownUntil?: number }> => {
	const availability = row.availability ?? { kind: "unavailable" };
	if (availability.kind === "cooldown" && availability.until > now) {
		return { cooldownUntil: availability.until };
	}
	return {};
};
const snapshot = (
	row: RoutingSeat,
	claims: readonly Claim[],
	now: number,
): RoutingRow => {
	let fiveHour: number | "unknown" = "unknown";
	let sevenDay: number | "unknown" = "unknown";
	if (row.usage !== "unknown") {
		fiveHour = utilization(row.usage.fiveHour);
		sevenDay = utilization(row.usage.sevenDay);
	}

	return {
		...cooldownFor(row, now),
		claims: claims.filter(
			(claim) => claim.seat === row.seat && activeClaim(claim, now),
		).length,
		fiveHour,
		live: row.live,
		seat: row.seat,
		sevenDay,
		status: availabilityStatus(row, now),
	};
};
const rankingUsage = (window: number | "unknown"): number => {
	if (window === "unknown") {
		return Number.POSITIVE_INFINITY;
	}
	return window;
};
// Two unknown windows tie instead of yielding Infinity - Infinity = NaN.
const compareUsage = (left: number, right: number): number =>
	Number(left > right) - Number(left < right);
const compare = (left: RoutingRow, right: RoutingRow): number =>
	left.live + left.claims - right.live - right.claims ||
	Number(rankingUsage(left.fiveHour) >= nearLimit) -
		Number(rankingUsage(right.fiveHour) >= nearLimit) ||
	compareUsage(rankingUsage(left.sevenDay), rankingUsage(right.sevenDay));
const chooseFallback = (
	rows: readonly RoutingRow[],
	lastFallbackSeat: SeatName,
): Decision => {
	// A cursor no longer in the registry (or "none") restarts at the first seat.
	const next = rows.findIndex((row) => row.seat === lastFallbackSeat) + one;
	const rotated = [...rows.slice(next), ...rows.slice(zero, next)];
	const [probed] = rotated
		.filter((row) => row.status === "probed")
		.toSorted(
			(left, right) => left.live + left.claims - right.live - right.claims,
		);
	if (probed) {
		return { mode: "auto", reason: fallbackReason, rows, seat: probed.seat };
	}
	if (
		rows.length > zero &&
		rows.every((row) => row.status === "exhausted" || row.status === "cooldown")
	) {
		return { mode: "auto", reason: "all seats exhausted", rows, seat: "none" };
	}
	return { mode: "auto", reason: "usage unavailable", rows, seat: "none" };
};

const chooseSeat = (
	seats: readonly RoutingSeat[],
	claims: readonly Claim[],
	{ now, manual, lastFallbackSeat = "none" }: RoutingOptions,
): Decision => {
	// `seats` arrive in registry order; toSorted is stable, so ties and fallback rotation keep it.
	const rows = seats.map((seat) => snapshot(seat, claims, now));
	if (typeof manual === "string") {
		return { mode: "manual", reason: "manual", rows, seat: manual };
	}
	const [first] = rows
		.filter((row) => row.status === "healthy")
		.toSorted(compare);
	if (first) {
		return { mode: "auto", reason: rankingReason, rows, seat: first.seat };
	}
	return chooseFallback(rows, lastFallbackSeat);
};

export type { Claim, Decision, RoutingOptions, RoutingSeat };
export { activeClaim, chooseSeat, fallbackReason, usageStatus };
