import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import type { TestContext } from "node:test";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { runBoundedCommand } from "./bounded-command.mjs";

const options = { maxBuffer: 1024, timeout: 1000 };
const unavailable = { status: "unavailable", stderr: "", stdout: "" };
const signalCheck = 0;
const retryMs = 20;
const retries = 50;
const one = 1;
type Context = Readonly<Pick<TestContext, "after">>;
const alive = (pid: number): boolean => {
	try {
		process.kill(pid, signalCheck);
		return true;
	} catch {
		return false;
	}
};
const waitForExit = async (pid: number, remaining = retries): Promise<void> => {
	if (remaining === signalCheck || !alive(pid)) {
		strictEqual(alive(pid), false, "the command left a running descendant");
		return;
	}
	await setTimeout(retryMs);
	await waitForExit(pid, remaining - one);
};

await test("bounded commands preserve successful streams and input, but discard spawn failures and oversized UTF-8 output", async (): Promise<void> => {
	deepStrictEqual(
		await runBoundedCommand("/bin/sh", ["-c", "cat; printf warning >&2"], {
			...options,
			input: "hello",
		}),
		{ status: 0, stderr: "warning", stdout: "hello" },
	);
	deepStrictEqual(
		await runBoundedCommand("/missing/fixture-command", [], options),
		unavailable,
	);
	deepStrictEqual(
		await runBoundedCommand("/bin/sh", ["-c", "printf 日本語"], {
			...options,
			maxBuffer: 8,
		}),
		unavailable,
	);
});

await test("deadline kills descendants even after the parent has exited", async (context: Context): Promise<void> => {
	const directory = await mkdtemp(path.join(tmpdir(), "claude-seats-command-"));
	context.after(async (): Promise<void> => {
		await rm(directory, { force: true, recursive: true });
	});
	const file = path.join(directory, "child.pid");
	deepStrictEqual(
		await runBoundedCommand(
			"/bin/sh",
			["-c", 'sleep 10 & echo $! > "$1"; exit 0', "fixture", file],
			options,
		),
		unavailable,
	);
	const pid = Number(await readFile(file, "utf8"));
	ok(Number.isSafeInteger(pid) && pid > signalCheck);
	await waitForExit(pid);
});
