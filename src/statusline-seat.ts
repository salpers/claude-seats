import { realpath } from "node:fs/promises";
import type { SeatName } from "./seats.ts";
import { createSeats, loadSeats } from "./seats.ts";
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
	names: readonly SeatName[],
): Promise<SeatName> => {
	const seats = await Promise.all(
		createSeats(home, names).map(async (seat) => ({
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

const configuredNames = async (
	home: string,
): Promise<readonly SeatName[] | false> => {
	// An empty home matches no seat; never resolve the config against the cwd.
	if (home === "") {
		return [];
	}
	const registry = await loadSeats(home);
	if (!registry.ok) {
		return false;
	}
	return registry.seats.map((seat) => seat.name);
};

const resolveStatuslineSeat = async (
	home: string,
	configDirectory?: string,
): Promise<SeatName> => {
	const names = await configuredNames(home);
	if (names === false) {
		return "unknown";
	}
	const direct = statuslineSeat(home, configDirectory, names);
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
	return matchDirectory(home, canonical, names);
};

export { resolveStatuslineSeat };
