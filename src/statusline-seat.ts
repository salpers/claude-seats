import { realpath } from "node:fs/promises";
import type { SeatName } from "./seats.ts";
import { createSeats } from "./seats.ts";
import { statuslineSeat } from "./statusline.ts";

const canonicalDirectory = async (
	directory: string,
): Promise<string | false> => {
	try {
		return await realpath(directory);
	} catch {
		return false;
	}
};

const matchDirectory = async (
	home: string,
	canonical: string,
): Promise<SeatName | "unknown"> => {
	const seats = await Promise.all(
		createSeats(home).map(async (seat) => ({
			directory: await canonicalDirectory(seat.directory),
			name: seat.name,
		})),
	);
	const match = seats.find(
		(seat: Readonly<{ directory: string | false; name: SeatName }>) =>
			seat.directory === canonical,
	);
	if (match) {
		return match.name;
	}
	return "unknown";
};

const resolveStatuslineSeat = async (
	home: string,
	configDirectory?: string,
): Promise<SeatName | "unknown"> => {
	const direct = statuslineSeat(home, configDirectory);
	if (
		direct !== "unknown" ||
		home === "" ||
		typeof configDirectory !== "string" ||
		configDirectory === ""
	) {
		return direct;
	}
	const canonical = await canonicalDirectory(configDirectory);
	if (canonical === false) {
		return "unknown";
	}
	return matchDirectory(home, canonical);
};

export { resolveStatuslineSeat };
