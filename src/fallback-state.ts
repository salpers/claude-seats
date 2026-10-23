import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Cooldown, FallbackState } from "./fallback.ts";
import { isRecord, parseJson } from "./json.ts";
import { isSeatName } from "./seats.ts";

type FallbackRead =
	| { readonly ok: true; readonly state: FallbackState }
	| { readonly ok: false };
const emptyFallback: FallbackState = { cooldowns: [], lastSeat: "none" };
const zero = 0;
const fileMode = 0o600;
const maxTimestamp = 8_640_000_000_000_000;
const parseCooldown = (value: unknown): Cooldown | false => {
	if (!isRecord(value)) {
		return false;
	}
	const { seat, until } = value;
	if (
		typeof seat !== "string" ||
		!isSeatName(seat) ||
		typeof until !== "number" ||
		!Number.isSafeInteger(until) ||
		until < zero ||
		until > maxTimestamp
	) {
		return false;
	}
	return { seat, until };
};
const validatedCooldowns = (
	values: readonly unknown[],
	lastSeat: FallbackState["lastSeat"],
): FallbackRead => {
	const entries = values.map((value) => parseCooldown(value));
	if (entries.some((entry) => entry === false)) {
		return { ok: false };
	}
	const valid = entries.filter((entry) => entry !== false);
	if (new Set(valid.map((entry) => entry.seat)).size !== valid.length) {
		return { ok: false };
	}
	return { ok: true, state: { cooldowns: valid, lastSeat } };
};

const parseFallbackState = (text: string): FallbackRead => {
	const parsed = parseJson(text);
	if (!(parsed.ok && isRecord(parsed.value))) {
		return { ok: false };
	}
	const { cooldowns, lastSeat } = parsed.value;
	if (
		!Array.isArray(cooldowns) ||
		typeof lastSeat !== "string" ||
		!(lastSeat === "none" || isSeatName(lastSeat))
	) {
		return { ok: false };
	}
	return validatedCooldowns(cooldowns, lastSeat);
};

const readFallbackState = async (directory: string): Promise<FallbackRead> => {
	try {
		return parseFallbackState(
			await readFile(path.join(directory, "fallback.json"), "utf8"),
		);
	} catch (error: unknown) {
		if (isRecord(error) && error["code"] === "ENOENT") {
			return { ok: true, state: emptyFallback };
		}
		return { ok: false };
	}
};
const cleanup = async (file: string): Promise<void> => {
	try {
		await rm(file, { force: true });
	} catch {
		// A cleanup failure must not expose filesystem diagnostics.
	}
};
const writeSafeFallback = async (
	directory: string,
	state: FallbackState,
): Promise<boolean> => {
	const file = path.join(directory, "fallback.json");
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(state)}\n`, {
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

const writeFallbackState = async (
	directory: string,
	state: FallbackState,
): Promise<boolean> => {
	const safe = parseFallbackState(JSON.stringify(state));
	if (!safe.ok) {
		return false;
	}
	const written = await writeSafeFallback(directory, safe.state);
	return written;
};

export { parseFallbackState, readFallbackState, writeFallbackState };
