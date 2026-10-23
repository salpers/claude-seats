import { isUtf8 } from "node:buffer";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { isRecord } from "./json.ts";

interface ConfigSnapshot {
	readonly ok: true;
	readonly exists: boolean;
	readonly mode: number;
	readonly text: string;
}
type ConfigRead = ConfigSnapshot | { readonly ok: false };
interface ConfigFileIo {
	readonly read: (file: string) => ConfigRead | Promise<ConfigRead>;
	readonly stage: (
		file: string,
		text: string,
		mode: number,
	) => void | Promise<void>;
	readonly rename: (temporary: string, file: string) => void | Promise<void>;
	readonly remove: (file: string) => void | Promise<void>;
}

const fileMode = 0o600;
const directoryMode = 0o700;
const modeBase = 0o1_0000;

const readSnapshot = async (
	file: string,
	mode: number,
): Promise<ConfigRead> => {
	const bytes = await readFile(file);
	if (!isUtf8(bytes)) {
		return { ok: false };
	}
	return { exists: true, mode, ok: true, text: bytes.toString("utf8") };
};

const readProjectFile = async (file: string): Promise<ConfigRead> => {
	try {
		const info = await lstat(file);
		if (!info.isFile()) {
			return { ok: false };
		}
		return await readSnapshot(file, info.mode % modeBase);
	} catch (error: unknown) {
		if (isRecord(error) && error["code"] === "ENOENT") {
			return { exists: false, mode: fileMode, ok: true, text: "{}" };
		}
		return { ok: false };
	}
};

const stage = async (
	file: string,
	text: string,
	mode: number,
): Promise<void> => {
	await mkdir(path.dirname(file), { mode: directoryMode, recursive: true });
	const handle = await open(file, "wx", fileMode);
	try {
		await handle.writeFile(text, "utf8");
		// Chmod restores the original permissions even under a restrictive umask.
		await handle.chmod(mode);
	} finally {
		await handle.close();
	}
};

const systemIo: ConfigFileIo = {
	read: readProjectFile,
	remove: async (file: string): Promise<void> => {
		await rm(file, { force: true });
	},
	rename,
	stage,
};

const cleanup = async (file: string, io: ConfigFileIo): Promise<void> => {
	try {
		await io.remove(file);
	} catch {
		// Cleanup failure must not block the launch or reveal config contents.
	}
};

const writeProjectFile = async (
	file: string,
	{ original, text }: Readonly<{ original: ConfigSnapshot; text: string }>,
	io: ConfigFileIo = systemIo,
): Promise<boolean> => {
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		await io.stage(temporary, text, original.mode);
		const current = await io.read(file);
		// Avoid overwriting changes observed during staging; rename makes publication atomic.
		if (
			!current.ok ||
			current.exists !== original.exists ||
			current.text !== original.text ||
			current.mode !== original.mode
		) {
			return false;
		}
		await io.rename(temporary, file);
		return true;
	} catch {
		return false;
	} finally {
		await cleanup(temporary, io);
	}
};

export type { ConfigFileIo, ConfigRead, ConfigSnapshot };
export { readProjectFile, writeProjectFile };
