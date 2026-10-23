import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { isRecord } from "./json.ts";

type SessionResult =
	| { readonly ok: true; readonly pid: number }
	| { readonly ok: false };

interface SessionIo {
	readonly readDirectory: (
		directory: string,
	) => readonly string[] | Promise<readonly string[]>;
	readonly probePid: (pid: number) => void;
}

const zero = 0;
// Node's process.kill accepts signed 32-bit PIDs; zero/negative values target groups.
const maxPid = 2_147_483_647;
// Claude Code writes both <pid>.<sha256>.key and <pid>.json into sessions/.
// Which form appears varies by version, so accept either and dedupe by PID.
const sessionName = /^(?<pid>\d+)(?:\.[0-9a-f]{64}\.key|\.json)$/u;
const isPid = (pid: number): boolean =>
	Number.isInteger(pid) && pid > zero && pid <= maxPid;
const systemIo: SessionIo = {
	probePid: (pid: number): void => {
		process.kill(pid, zero);
	},
	readDirectory: async (directory: string): Promise<readonly string[]> => {
		const entries = await readdir(directory, { withFileTypes: true });
		const files: string[] = [];
		for (const entry of entries) {
			if (entry.isFile()) {
				files.push(entry.name);
			}
		}
		return files;
	},
};

const parseSession = (filename: string): SessionResult => {
	const match = sessionName.exec(filename);
	if (!match) {
		return { ok: false };
	}
	const { groups } = match;
	if (!groups) {
		return { ok: false };
	}
	const pid = Number(groups["pid"]);
	if (isPid(pid)) {
		return { ok: true, pid };
	}
	return { ok: false };
};

const isAlive = (pid: number, io: SessionIo): boolean => {
	try {
		io.probePid(pid);
		return true;
	} catch (error: unknown) {
		// A process can exist even when the caller may not signal it.
		return isRecord(error) && error["code"] === "EPERM";
	}
};

const listSessionFiles = async (
	directory: string,
	io: SessionIo,
): Promise<readonly string[]> => {
	try {
		return await io.readDirectory(directory);
	} catch {
		return [];
	}
};

const countLiveSessions = async (
	directory: string,
	io: SessionIo = systemIo,
): Promise<number> => {
	const registry = path.join(directory, "sessions");
	const files = await listSessionFiles(registry, io);
	const pids = new Set<number>();
	for (const file of files) {
		const entry = parseSession(file);
		if (entry.ok) {
			pids.add(entry.pid);
		}
	}
	return [...pids].filter((pid) => isAlive(pid, io)).length;
};

export type { SessionIo, SessionResult };
export { countLiveSessions, isPid, parseSession };
