import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { ConfigRead, ConfigSnapshot } from "./project-config-file.ts";
import { createSeats } from "./seats.ts";
import type { ProjectSyncIo } from "./sync-projects.ts";
import { syncProjects } from "./sync-projects.ts";

const seats = createSeats("/fixture");
const snapshot = (text: string): ConfigSnapshot => ({
	exists: true,
	mode: 0o600,
	ok: true,
	text,
});
const source = JSON.stringify({
	projects: { "/repo": { hasTrustDialogAccepted: true } },
});
const empty = "{}";
const zero = 0;
const one = 1;

await test("all inputs are snapshotted before any writes and a second sync performs no writes", async (): Promise<void> => {
	const files = new Map<string, string>([
		["/fixture/.claude.json", empty],
		["/fixture/.claude-dev/.claude.json", source],
		["/fixture/.claude-dev2/.claude.json", empty],
		["/fixture/.claude-dev3/.claude.json", empty],
	]);
	const reads = new Set<string>();
	let writes = zero;
	const io: ProjectSyncIo = {
		read: (file: string): ConfigRead => {
			reads.add(file);
			return snapshot(files.get(file) ?? empty);
		},
		write: (file: string, _original: ConfigSnapshot, text: string): boolean => {
			strictEqual(reads.size, seats.length);
			writes += one;
			files.set(file, text);
			return true;
		},
	};
	deepStrictEqual(await syncProjects(seats, io), []);
	strictEqual(writes, seats.length - one);
	deepStrictEqual(
		[...files.values()],
		seats.map(() => source),
	);
	writes = zero;
	deepStrictEqual(await syncProjects(seats, io), []);
	strictEqual(writes, zero);
});

await test("unreadable, malformed and unwritable seats report safe failures independently", async (): Promise<void> => {
	const written: string[] = [];
	const io: ProjectSyncIo = {
		read: (file: string): ConfigRead => {
			if (file.includes(".claude-dev2/")) {
				return { ok: false };
			}
			if (file.includes(".claude-dev3/")) {
				return snapshot("private malformed data");
			}
			if (file.includes(".claude-dev/")) {
				return snapshot(source);
			}
			return snapshot(empty);
		},
		write: (file: string): boolean => {
			written.push(file);
			return false;
		},
	};
	deepStrictEqual(await syncProjects(seats, io), [
		{ reason: "unreadable config", seat: "dev2" },
		{ reason: "invalid config", seat: "dev3" },
		{ reason: "write failed or config changed", seat: "main" },
	]);
	deepStrictEqual(written, ["/fixture/.claude.json"]);
});

const fail = (): never => {
	throw new Error("private I/O diagnostic");
};
const failures: readonly (() => never | Promise<never>)[] = [
	fail,
	async (): Promise<never> => {
		await Promise.resolve();
		return fail();
	},
];

await test("thrown and rejected read failures skip only that seat and never reflect the error", async (): Promise<void> => {
	await Promise.all(
		failures.map(async (readFailure): Promise<void> => {
			const written = new Map<string, string>();
			const io: ProjectSyncIo = {
				read: (file: string): ConfigRead | Promise<ConfigRead> => {
					if (file.includes(".claude-dev2/")) {
						return readFailure();
					}
					if (file.includes(".claude-dev/")) {
						return snapshot(source);
					}
					return snapshot(empty);
				},
				write: (
					file: string,
					_original: ConfigSnapshot,
					text: string,
				): boolean => {
					written.set(file, text);
					return true;
				},
			};
			deepStrictEqual(await syncProjects(seats, io), [
				{ reason: "unreadable config", seat: "dev2" },
			]);
			deepStrictEqual(
				written,
				new Map([
					["/fixture/.claude.json", source],
					["/fixture/.claude-dev3/.claude.json", source],
				]),
			);
		}),
	);
});

await test("thrown and rejected write failures preserve the donor and do not interrupt other seats", async (): Promise<void> => {
	await Promise.all(
		failures.map(async (writeFailure): Promise<void> => {
			const files = new Map<string, string>([
				["/fixture/.claude.json", empty],
				["/fixture/.claude-dev/.claude.json", source],
				["/fixture/.claude-dev2/.claude.json", empty],
				["/fixture/.claude-dev3/.claude.json", empty],
			]);
			const io: ProjectSyncIo = {
				read: (file: string): ConfigRead => snapshot(files.get(file) ?? empty),
				write: (
					file: string,
					_original: ConfigSnapshot,
					text: string,
				): boolean | Promise<boolean> => {
					if (file.includes(".claude-dev2/")) {
						return writeFailure();
					}
					files.set(file, text);
					return true;
				},
			};
			deepStrictEqual(await syncProjects(seats, io), [
				{ reason: "write failed or config changed", seat: "dev2" },
			]);
			deepStrictEqual([...files.values()], [source, source, empty, source]);
		}),
	);
});
