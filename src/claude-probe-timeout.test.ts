import { deepStrictEqual, ok } from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { test } from "node:test";
import { probeClaude } from "./claude-probe.ts";
import { createSeats } from "./seats.ts";

type Context = Readonly<Pick<TestContext, "after">>;
const executableMode = 0o700;
const fixture = async (
	context: Context,
): Promise<Readonly<{ home: string; binary: string }>> => {
	const home = await mkdtemp(path.join(tmpdir(), "claude-seats-timeout-"));
	context.after(async (): Promise<void> => {
		await rm(home, { force: true, recursive: true });
	});
	return { binary: path.join(home, "fake-claude"), home };
};

const maximumMs = 16_500;

await test("probe deadline covers live and exited parents whose descendants hold the pipes", async (context: Context): Promise<void> => {
	await Promise.all(
		["exit 0", "wait"].map(async (ending): Promise<void> => {
			const setup = await fixture(context);
			await writeFile(
				setup.binary,
				`#!/bin/sh\nsleep 17 &\nprintf Hello\n${ending}\n`,
				{ mode: executableMode },
			);
			const [seat] = createSeats(setup.home);
			ok(seat);
			const started = performance.now();
			deepStrictEqual(
				await probeClaude(seat, {
					binary: setup.binary,
					env: Object.fromEntries([
						["HOME", setup.home],
						["PATH", "/usr/bin:/bin"],
					]),
				}),
				{ kind: "unavailable" },
			);
			ok(
				performance.now() - started < maximumMs,
				"probe deadline was not enforced",
			);
		}),
	);
});
