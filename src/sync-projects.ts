import path from "node:path";
import type { ConfigRead, ConfigSnapshot } from "./project-config-file.ts";
import { readProjectFile, writeProjectFile } from "./project-config-file.ts";
import type { ProjectConfig } from "./project-sync.ts";
import { mergeProjectConfig, parseProjectConfig } from "./project-sync.ts";
import type { Seat, SeatName } from "./seats.ts";

interface ProjectSyncIo {
	readonly read: (file: string) => ConfigRead | Promise<ConfigRead>;
	readonly write: (
		file: string,
		original: ConfigSnapshot,
		text: string,
	) => boolean | Promise<boolean>;
}
interface SyncFailure {
	readonly seat: SeatName;
	readonly reason:
		| "unreadable config"
		| "invalid config"
		| "write failed or config changed";
}
interface LoadedSeat {
	readonly seat: Seat;
	readonly file: string;
	readonly original: ConfigSnapshot;
	readonly config: ProjectConfig;
}
type LoadResult =
	| { readonly ok: true; readonly entry: LoadedSeat }
	| { readonly ok: false; readonly failure: SyncFailure };
const systemIo: ProjectSyncIo = {
	read: readProjectFile,
	write: async (
		file: string,
		original: ConfigSnapshot,
		text: string,
	): Promise<boolean> => writeProjectFile(file, { original, text }),
};

const configFile = (seat: Seat): string => {
	let { directory } = seat;
	if (seat.name === "main") {
		directory = path.dirname(directory);
	}
	return path.join(directory, ".claude.json");
};

const readConfig = async (
	file: string,
	io: ProjectSyncIo,
): Promise<ConfigRead> => {
	try {
		return await io.read(file);
	} catch {
		return { ok: false };
	}
};

const loadSeat = async (seat: Seat, io: ProjectSyncIo): Promise<LoadResult> => {
	const file = configFile(seat);
	const original = await readConfig(file, io);
	if (!original.ok) {
		return {
			failure: { reason: "unreadable config", seat: seat.name },
			ok: false,
		};
	}
	const parsed = parseProjectConfig(original.text);
	if (!parsed.ok) {
		return {
			failure: { reason: "invalid config", seat: seat.name },
			ok: false,
		};
	}
	return { entry: { config: parsed.config, file, original, seat }, ok: true };
};

const saveSeat = async (
	entry: LoadedSeat,
	sources: readonly ProjectConfig[],
	io: ProjectSyncIo,
): Promise<readonly SyncFailure[]> => {
	const text = mergeProjectConfig(entry.config, sources);
	if (text === entry.original.text) {
		return [];
	}
	try {
		if (await io.write(entry.file, entry.original, text)) {
			return [];
		}
	} catch {
		// A seat's I/O failure must neither abort launch nor expose config data.
	}
	return [{ reason: "write failed or config changed", seat: entry.seat.name }];
};

const syncProjects = async (
	seats: readonly Seat[],
	io: ProjectSyncIo = systemIo,
): Promise<readonly SyncFailure[]> => {
	const results = await Promise.all(
		seats.map(async (seat) => loadSeat(seat, io)),
	);
	const loaded = results
		.filter((result) => result.ok)
		.map((result) => result.entry);
	const failures = results
		.filter((result) => !result.ok)
		.map((result) => result.failure);
	// Every destination sees the same original sources, independent of write order.
	const sources = loaded.map((entry) => entry.config);
	const writes = await Promise.all(
		loaded.map(async (entry) => saveSeat(entry, sources, io)),
	);
	return [...failures, ...writes.flat()];
};

export type { ProjectSyncIo, SyncFailure };
export { syncProjects };
