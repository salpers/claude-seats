import { mkdir } from "node:fs/promises";
import type { SeatProbe } from "./fallback.ts";
import { prepareFallback } from "./fallback.ts";
import { readFallbackState, writeFallbackState } from "./fallback-state.ts";
import type { RoutingSeat } from "./router.ts";
import { chooseSeat, fallbackReason } from "./router.ts";
import type { DecisionOptions, RoutingResult } from "./routing-audit.ts";
import { recordDecision, resumeFields, unavailable } from "./routing-audit.ts";
import { createStateIo } from "./routing-files.ts";
import { acquireRoutingLock, releaseRoutingLock } from "./routing-lock.ts";
import type { LockedOptions } from "./routing-probes.ts";
import { prepareRoutingProbes } from "./routing-probes.ts";
import type { SeatName } from "./seats.ts";

const directoryMode = 0o700;
const recordFallback = async (
	directory: string,
	rows: readonly RoutingSeat[],
	{
		probe,
		resume,
	}: Readonly<{ probe: SeatProbe; resume: DecisionOptions["resume"] }>,
): Promise<RoutingResult> => {
	const stored = await readFallbackState(directory);
	if (!stored.ok) {
		return unavailable;
	}
	const prepared = await prepareFallback(rows, stored.state, {
		now: Date.now(),
		probe,
	});
	if (
		JSON.stringify(prepared.state) !== JSON.stringify(stored.state) &&
		!(await writeFallbackState(directory, prepared.state))
	) {
		return unavailable;
	}
	const result = await recordDecision(prepared.rows, createStateIo(directory), {
		lastFallbackSeat: prepared.state.lastSeat,
		now: Date.now(),
		resume,
	});
	if (
		result.ok &&
		result.decision.reason === fallbackReason &&
		!(await writeFallbackState(directory, {
			...prepared.state,
			lastSeat: result.decision.seat,
		}))
	) {
		return unavailable;
	}
	return result;
};

const routingMode = (mode: SeatName | LockedOptions): LockedOptions => {
	if (typeof mode === "string") {
		return { manual: mode };
	}
	return mode;
};

const recordSelection = async (
	directory: string,
	readSeats: () => readonly RoutingSeat[] | Promise<readonly RoutingSeat[]>,
	{ manual, probe, resume }: LockedOptions,
): Promise<RoutingResult> => {
	// Counts and claims must be read under the same lock as reservation and audit writes.
	const rows = await readSeats();
	if (probe && !manual) {
		return recordFallback(directory, rows, { probe, resume });
	}
	return recordDecision(rows, createStateIo(directory), {
		manual,
		now: Date.now(),
		resume,
	});
};
const recordLocked = async (
	directory: string,
	readSeats: () => readonly RoutingSeat[] | Promise<readonly RoutingSeat[]>,
	options: LockedOptions & Readonly<{ owner: string }>,
): Promise<RoutingResult> => {
	let result: RoutingResult = unavailable;
	try {
		result = await recordSelection(directory, readSeats, options);
	} catch {
		result = unavailable;
	} finally {
		if (!(await releaseRoutingLock(directory, options.owner))) {
			result = unavailable;
		}
	}
	return result;
};

const recordBusy = async (
	directory: string,
	{ manual, resume }: LockedOptions,
): Promise<RoutingResult> => {
	if (typeof manual !== "string") {
		return {
			ok: false,
			reason: "routing busy; check routing.lock in the state directory",
		};
	}
	const now = Date.now();
	// A busy lock must not block the escape hatch or let it overwrite the owner's claims.
	const decision = chooseSeat([], [], { manual, now });
	const line = JSON.stringify({
		at: now,
		...decision,
		...resumeFields(resume),
		reservation: "skipped: routing busy",
	});
	if (!(await createStateIo(directory).append(`${line}\n`))) {
		return unavailable;
	}
	return { decision, ok: true };
};

const reserve = async (
	directory: string,
	readSeats: () => readonly RoutingSeat[] | Promise<readonly RoutingSeat[]>,
	options: LockedOptions,
): Promise<RoutingResult> => {
	const acquired = await acquireRoutingLock(directory);
	if (acquired.kind === "unavailable") {
		return unavailable;
	}
	if (acquired.kind === "busy") {
		return recordBusy(directory, options);
	}
	return recordLocked(directory, readSeats, {
		...options,
		owner: acquired.owner,
	});
};

const routeWithState = async (
	directory: string,
	readSeats: () => readonly RoutingSeat[] | Promise<readonly RoutingSeat[]>,
	mode: SeatName | LockedOptions = {},
): Promise<RoutingResult> => {
	try {
		await mkdir(directory, { mode: directoryMode, recursive: true });
		const options = await prepareRoutingProbes(
			directory,
			readSeats,
			routingMode(mode),
		);
		if (options === false) {
			return unavailable;
		}
		return await reserve(directory, readSeats, options);
	} catch {
		return unavailable;
	}
};

export { routeWithState };
