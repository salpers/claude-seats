import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isRecord, parseJson } from "./json.ts";
import type { SeatName } from "./seats.ts";
import type { Usage, UsageResult } from "./usage.ts";
import { parseUsage } from "./usage.ts";

interface UsageSnapshot {
	readonly fetchedAt: number;
	readonly usage: Usage;
}

type CacheResult =
	| { readonly ok: true; readonly snapshot: UsageSnapshot }
	| { readonly ok: false };
interface UsageCache {
	readonly read: (seat: SeatName) => CacheResult | Promise<CacheResult>;
	readonly write: (
		seat: SeatName,
		snapshot: UsageSnapshot,
	) => boolean | Promise<boolean>;
}
const fileMode = 0o600;
const directoryMode = 0o700;
const zero = 0;

const snapshotFromUsage = (
	fetchedAt: number,
	result: UsageResult,
): CacheResult => {
	if (!result.ok) {
		return { ok: false };
	}
	return { ok: true, snapshot: { fetchedAt, usage: result.usage } };
};

const parseSnapshot = (text: string): CacheResult => {
	const parsed = parseJson(text);
	if (!(parsed.ok && isRecord(parsed.value))) {
		return { ok: false };
	}
	const { fetchedAt, usage } = parsed.value;
	if (
		typeof fetchedAt !== "number" ||
		!Number.isSafeInteger(fetchedAt) ||
		fetchedAt < zero
	) {
		return { ok: false };
	}
	return snapshotFromUsage(fetchedAt, parseUsage(usage, true));
};

const cleanup = async (temporary: string): Promise<void> => {
	try {
		await rm(temporary, { force: true });
	} catch {
		// A failed cleanup cannot make a successful usage request fail.
	}
};

const writeSafeSnapshot = async (
	file: string,
	snapshot: UsageSnapshot,
): Promise<boolean> => {
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		await mkdir(path.dirname(file), { mode: directoryMode, recursive: true });
		await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, {
			flag: "wx",
			mode: fileMode,
		});
		await rename(temporary, file);
		return true;
	} catch {
		return false;
	} finally {
		await cleanup(temporary);
	}
};

const writeSnapshot = async (
	file: string,
	snapshot: UsageSnapshot,
): Promise<boolean> => {
	// Project typed callers too: extra properties must never reach disk.
	const safe = parseSnapshot(
		JSON.stringify({ fetchedAt: snapshot.fetchedAt, usage: snapshot.usage }),
	);
	if (!safe.ok) {
		return false;
	}
	const written = await writeSafeSnapshot(file, safe.snapshot);
	return written;
};

const createUsageCache = (directory: string): UsageCache => ({
	read: async (seat: SeatName): Promise<CacheResult> => {
		try {
			return parseSnapshot(
				await readFile(path.join(directory, `usage-${seat}.json`), "utf8"),
			);
		} catch {
			return { ok: false };
		}
	},
	write: async (seat: SeatName, snapshot: UsageSnapshot): Promise<boolean> =>
		writeSnapshot(path.join(directory, `usage-${seat}.json`), snapshot),
});

export type { CacheResult, UsageCache, UsageSnapshot };
export { createUsageCache, parseSnapshot };
