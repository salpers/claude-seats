import { ok, strictEqual } from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdir, utimes } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { seedRouting } from "./routing-fixture.ts";
import type { Context, Fixture } from "./shim-fixture.ts";
import { fixture, run } from "./shim-fixture.ts";

const success = 0;
const one = 1;
const four = 4;
const timeout = 10_000;
const holderScript = `
const { routeWithState } = await import(process.argv[1]);
await routeWithState(process.argv[2], async () => {
  process.stdout.write("locked\\n");
  await new Promise(resolve => setTimeout(resolve, 60_000));
  return [];
});
`;
const abandonLock = async (setup: Fixture): Promise<void> => {
	const child = spawn(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			holderScript,
			new URL("../src/routing-state.ts", import.meta.url).href,
			path.join(setup.directory, "state"),
		],
		{
			cwd: setup.directory,
			env: {},
			killSignal: "SIGKILL",
			stdio: ["ignore", "pipe", "ignore"],
			timeout,
		},
	);
	const closed = once(child, "close");
	try {
		await once(child.stdout, "data");
	} finally {
		child.kill("SIGKILL");
		await closed;
	}
	strictEqual(child.signalCode, "SIGKILL");
};

const ageAbandonedLock = async (setup: Fixture): Promise<void> => {
	const directory = path.join(setup.directory, "state");
	const lock = path.join(directory, "routing.lock");
	const entries = await readdir(lock);
	strictEqual(entries.length, one);
	const old = new Date("2000-01-01T00:00:00Z");
	await utimes(lock, old, old);
};

await test("four independent cc processes recover a killed lock owner without losing reservations", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await seedRouting(setup);
	await abandonLock(setup);
	await ageAbandonedLock(setup);
	const results = await Promise.all(
		Array.from({ length: four }, async () => run(setup, [])),
	);
	for (const result of results) {
		strictEqual(result.status, success, result.stderr);
	}
	strictEqual(
		new Set(
			results.map((result: Readonly<{ stderr: string }>) => result.stderr),
		).size,
		four,
	);
	const files = await readdir(path.join(setup.directory, "state"));
	ok(files.every((file) => !file.startsWith("routing.lock")));
});
