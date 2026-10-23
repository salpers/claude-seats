import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runBoundedCommand } from "./bounded-command.mjs";
import { isRecord } from "./json.ts";
import type { Seat, SeatName } from "./seats.ts";
import { sessionRegistry } from "./setup-layout.ts";

type SessionResult =
	| { readonly ok: true; readonly pid: number }
	| { readonly ok: false };

interface SessionIo {
	readonly readDirectory: (
		directory: string,
	) => readonly string[] | Promise<readonly string[]>;
	readonly probePid: (pid: number) => void;
	readonly resolveDirectory: (directory: string) => string | Promise<string>;
	// Each PID's command line, followed by its environment.
	readonly readCommands: (
		pids: readonly number[],
	) => ReadonlyMap<number, string> | Promise<ReadonlyMap<number, string>>;
}

const zero = 0;
// Node's process.kill accepts signed 32-bit PIDs; zero/negative values target groups.
const maxPid = 2_147_483_647;
// Claude Code writes both <pid>.<sha256>.key and <pid>.json into sessions/.
// Which form appears varies by version, so accept either and dedupe by PID.
const sessionName = /^(?<pid>\d+)(?:\.[0-9a-f]{64}\.key|\.json)$/u;
const isPid = (pid: number): boolean =>
	Number.isInteger(pid) && pid > zero && pid <= maxPid;
const commandLine = /^\s*(?<pid>\d+) (?<command>.*)$/u;
const configVariable = " CLAUDE_CONFIG_DIR=";
const pathEnd = /^\/?(?:\s|$)/u;
const psTimeout = 5000;
const psBuffer = 8_388_608;
const printableStart = 32;
const printableEnd = 126;
const octal = 8;
const octalDigits = 3;

// Ps prints control and non-ASCII bytes of an environment as octal escapes, such as \012 for a newline.
const psEscaped = (text: string): string =>
	[...Buffer.from(text)]
		.map((byte) => {
			if (byte < printableStart || byte > printableEnd) {
				return `\\${byte.toString(octal).padStart(octalDigits, "0")}`;
			}
			return String.fromCodePoint(byte);
		})
		.join("");
const namesDirectory = (value: string, directory: string): boolean =>
	[directory, psEscaped(directory)].some(
		(spelling) =>
			value.startsWith(spelling) && pathEnd.test(value.slice(spelling.length)),
	);

const parseCommand = (line: string): readonly [number, string][] => {
	const match = commandLine.exec(line);
	if (!match) {
		return [];
	}
	const { groups } = match;
	if (!groups) {
		return [];
	}
	const { command, pid } = groups;
	if (isPid(Number(pid)) && typeof command === "string") {
		return [[Number(pid), command]];
	}
	return [];
};
const parseCommands = (stdout: string): ReadonlyMap<number, string> =>
	new Map(stdout.split("\n").flatMap((line) => parseCommand(line)));

const systemIo: SessionIo = {
	probePid: (pid: number): void => {
		process.kill(pid, zero);
	},
	readCommands: async (
		pids: readonly number[],
	): Promise<ReadonlyMap<number, string>> => {
		if (pids.length === zero) {
			return new Map();
		}
		// On macOS, `ps -E` appends the environment. It can hold tokens, so only the seat leaves this module.
		const reply = await runBoundedCommand(
			"/bin/ps",
			["-E", "-ww", "-o", "pid=", "-o", "command=", "-p", pids.join(",")],
			{ maxBuffer: psBuffer, timeout: psTimeout },
		);
		return parseCommands(reply.stdout);
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
	resolveDirectory: async (directory: string): Promise<string> => {
		try {
			return await realpath(directory);
		} catch {
			return directory;
		}
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

const livePids = async (
	directory: string,
	io: SessionIo,
): Promise<readonly number[]> => {
	const files = await listSessionFiles(directory, io);
	const pids = new Set<number>();
	for (const file of files) {
		const entry = parseSession(file);
		if (entry.ok) {
			pids.add(entry.pid);
		}
	}
	return [...pids].filter((pid) => isAlive(pid, io));
};

// The last CLAUDE_CONFIG_DIR wins because the environment follows the arguments; an argument that spells one misleads it only when the environment has none.
const seatsOf = (
	command: string,
	seats: readonly Seat[],
): readonly SeatName[] => {
	const start = command.lastIndexOf(configVariable);
	if (start < zero) {
		// Without CLAUDE_CONFIG_DIR, Claude Code uses bare ~/.claude.
		return seats
			.filter((seat) => seat.name === "main")
			.map((seat) => seat.name);
	}
	const value = command.slice(start + configVariable.length);
	return seats
		.filter((seat) => namesDirectory(value, seat.directory))
		.map((seat) => seat.name);
};

// One registry behind several seats' links tells their sessions apart by CLAUDE_CONFIG_DIR.
const countRegistry = async (
	directory: string,
	seats: readonly Seat[],
	io: SessionIo,
): Promise<readonly (readonly [SeatName, number])[]> => {
	const pids = await livePids(directory, io);
	const [only, ...others] = seats;
	if (only && others.length === zero) {
		return [[only.name, pids.length]];
	}
	const commands = await io.readCommands(pids);
	// A PID without a command line exited after the liveness check.
	const owners = pids.flatMap((pid) => {
		const command = commands.get(pid);
		if (typeof command === "string") {
			return seatsOf(command, seats);
		}
		return [];
	});
	return seats.map((seat) => [
		seat.name,
		owners.filter((owner) => owner === seat.name).length,
	]);
};

const countLiveSessions = async (
	seats: readonly Seat[],
	io: SessionIo = systemIo,
): Promise<ReadonlyMap<SeatName, number>> => {
	const registries = await Promise.all(
		seats.map(async (seat) =>
			io.resolveDirectory(path.join(seat.directory, sessionRegistry)),
		),
	);
	const counts = await Promise.all(
		[...new Set(registries)].map(async (registry) =>
			countRegistry(
				registry,
				seats.filter((_seat, index) => registries[index] === registry),
				io,
			),
		),
	);
	return new Map(counts.flat());
};

export type { SessionIo, SessionResult };
export { countLiveSessions, isPid, parseCommands, parseSession, seatsOf };
