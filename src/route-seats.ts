import path from "node:path";
import type { ProbeResult } from "./claude-probe.ts";
import { probeClaude } from "./claude-probe.ts";
import { readSeatRows, stateDirectory } from "./list-seats.ts";
import type { SeatRow } from "./output.ts";
import { formatSeats } from "./output.ts";
import type { ResumeMetadata } from "./resume.ts";
import type { Decision, RoutingSeat } from "./router.ts";
import { fallbackReason } from "./router.ts";
import { routeWithState } from "./routing-state.ts";
import type { Seat, SeatName } from "./seats.ts";
import { countLiveSessions } from "./sessions.ts";
import type { Usage } from "./usage.ts";

type Selection =
	| {
			readonly ok: true;
			readonly seat: SeatName;
			readonly notices: readonly string[];
	  }
	| { readonly ok: false; readonly reason: string; readonly exitCode: number };
interface SeatEnvironment {
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly home: string;
	readonly resume?: ResumeMetadata;
}
const exhausted = 3;
const unavailable = 1;
const zero = 0;
const minuteMs = 60_000;
const canProbe = (row: SeatRow | undefined): boolean => {
	if (!row) {
		return false;
	}
	if (!(row.credential.ok && row.credential.present)) {
		return false;
	}
	return (
		row.usage.ok ||
		!["not logged in", "invalid credential", "credential unavailable"].includes(
			row.usage.reason,
		)
	);
};
const usageFor = (row: SeatRow | undefined): Usage | "unknown" => {
	if (!row) {
		return "unknown";
	}
	if (!row.usage.ok) {
		return "unknown";
	}
	return row.usage.usage;
};
const routingRows = async (
	seats: readonly Seat[],
	rows: readonly SeatRow[],
): Promise<readonly RoutingSeat[]> => {
	const live = await countLiveSessions(seats);
	return seats.map((seat): RoutingSeat => {
		const row = rows.find((entry) => entry.seat.name === seat.name);
		return {
			live: live.get(seat.name) ?? zero,
			probe: canProbe(row),
			seat: seat.name,
			usage: usageFor(row),
		};
	});
};
const refuse = (reason: string, rows: readonly SeatRow[]): Selection => {
	let exitCode = unavailable;
	if (reason === "all seats exhausted") {
		exitCode = exhausted;
	}
	return {
		exitCode,
		ok: false,
		reason: `${reason}.\n${formatSeats(rows)}\nUse cc @<seat> to override.`,
	};
};
const fallbackNotices = (
	rows: readonly SeatRow[],
	decision: Decision,
): readonly string[] => {
	const notices = rows.flatMap((row) => {
		if (row.usage.ok && row.usage.cachedAgeMs > zero) {
			return [
				`${row.seat.name}: (usage cached ${Math.floor(row.usage.cachedAgeMs / minuteMs)}m ago)`,
			];
		}
		return [];
	});
	if (decision.reason === fallbackReason) {
		notices.push("usage unavailable; fallback probes and round-robin active");
	}
	return notices;
};
const withCooldowns = (
	rows: readonly SeatRow[],
	decision: Decision,
): readonly SeatRow[] =>
	rows.map((row) => {
		const snapshot = decision.rows.find(
			(entry) => entry.seat === row.seat.name,
		);
		if (snapshot && typeof snapshot.cooldownUntil === "number") {
			return { ...row, cooldownUntil: snapshot.cooldownUntil };
		}
		return row;
	});
const routingFailure = (reason: string, directory: string): Selection => {
	if (reason === "claims unavailable") {
		return {
			exitCode: unavailable,
			ok: false,
			reason: `routing state unavailable; cannot read valid claims from ${JSON.stringify(path.join(directory, "claims.json"))}; repair that file before retrying.`,
		};
	}
	return { exitCode: unavailable, ok: false, reason };
};

const routeSeats = async (
	seats: readonly Seat[],
	{ env, home, resume }: SeatEnvironment,
	manual?: SeatName,
): Promise<Selection> => {
	let rows: readonly SeatRow[] = [];
	if (typeof manual !== "string") {
		rows = await readSeatRows(seats, env, home);
	}
	const result = await routeWithState(
		stateDirectory(env, home),
		async () => routingRows(seats, rows),
		{
			manual,
			probe: async (name: SeatName): Promise<ProbeResult> => {
				const seat = seats.find((entry) => entry.name === name);
				if (!seat) {
					throw new TypeError("Probe seat missing from registry");
				}
				const probed = await probeClaude(seat, {
					binary: env["CLAUDE_SEATS_CLAUDE_BIN"] ?? "claude",
					env,
				});
				return probed;
			},
			resume,
		},
	);
	if (!result.ok) {
		return routingFailure(result.reason, stateDirectory(env, home));
	}
	if (result.decision.seat === "none") {
		return refuse(result.decision.reason, withCooldowns(rows, result.decision));
	}
	return {
		notices: fallbackNotices(rows, result.decision),
		ok: true,
		seat: result.decision.seat,
	};
};

export type { SeatEnvironment, Selection };
export { routeSeats };
