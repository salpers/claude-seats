import type { Stats } from "node:fs";
import { constants } from "node:fs";
import {
	access,
	lstat,
	mkdir,
	readlink,
	realpath,
	symlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isRecord } from "./json.ts";
import type { LayoutEntry } from "./setup-layout.ts";

type EntryState = "ready" | "missing" | "conflict";
const privateDirectoryMode = 0o700;
const privateFileMode = 0o600;
const modeBase = 0o1000;

const matchesEntry = async (
	entry: LayoutEntry,
	info: Readonly<Pick<Stats, "isDirectory" | "isFile" | "isSymbolicLink">>,
): Promise<boolean> => {
	if (entry.kind === "link") {
		return (
			info.isSymbolicLink() &&
			(await realpath(entry.file)) === (await realpath(entry.target))
		);
	}
	if (entry.kind === "directory" && info.isDirectory()) {
		await access(entry.file, constants.R_OK + constants.X_OK);
		return true;
	}
	if (entry.kind === "file" && info.isFile()) {
		await access(entry.file, constants.R_OK);
		return true;
	}
	return false;
};

const readInfo = async (
	file: string,
): Promise<Stats | "missing" | "conflict"> => {
	try {
		return await lstat(file);
	} catch (error: unknown) {
		if (isRecord(error) && error["code"] === "ENOENT") {
			return "missing";
		}
		return "conflict";
	}
};

const inspectEntry = async (entry: LayoutEntry): Promise<EntryState> => {
	const info = await readInfo(entry.file);
	if (typeof info === "string") {
		return info;
	}
	try {
		if (await matchesEntry(entry, info)) {
			return "ready";
		}
	} catch {
		// Paths and file contents are not trusted diagnostics.
	}
	return "conflict";
};

const missingLinkTarget = async (entry: LayoutEntry): Promise<boolean> => {
	if (entry.kind !== "link") {
		return false;
	}
	try {
		const target = await readlink(entry.file);
		const absolute = path.resolve(entry.target);
		const relative = path.relative(path.dirname(entry.file), absolute);
		// Collapsing a link's extra '..' components can hide missing or redirected parents.
		return (
			(target === absolute || target === relative) &&
			(await readInfo(entry.target)) === "missing"
		);
	} catch {
		return false;
	}
};

const createEntry = async (entry: LayoutEntry): Promise<boolean> => {
	try {
		if (entry.kind === "directory") {
			await mkdir(entry.file, { mode: privateDirectoryMode, recursive: true });
		} else if (entry.kind === "link") {
			await symlink(entry.target, entry.file);
		} else {
			await writeFile(entry.file, "", { flag: "wx", mode: privateFileMode });
		}
	} catch {
		// A concurrent installer may have created the same entry; never replace it.
	}
	return (await inspectEntry(entry)) === "ready";
};

const privateStateDirectory = async (directory: string): Promise<boolean> => {
	try {
		const info = await lstat(directory);
		if (!info.isDirectory() || info.mode % modeBase !== privateDirectoryMode) {
			return false;
		}
		await access(directory, constants.R_OK + constants.W_OK + constants.X_OK);
		return true;
	} catch {
		return false;
	}
};

export type { EntryState };
export { createEntry, inspectEntry, missingLinkTarget, privateStateDirectory };
