import { ok, strictEqual } from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import type { Context, Fixture } from "./shim-fixture.ts";
import { fixture, run } from "./shim-fixture.ts";

const shellQuote = (text: string): string =>
	`'${text.replaceAll("'", String.raw`'\''`)}'`;
const failure = 1;
const success = 0;
const executableMode = 0o700;
const withVersion = async (context: Context): Promise<Fixture> => {
	const setup = await fixture(context);
	const node = path.join(path.dirname(setup.binary), "node");
	await rm(node);
	await writeFile(
		node,
		`#!/bin/sh
exec ${shellQuote(process.execPath)} --input-type=module -e 'import { pathToFileURL } from "node:url"; Object.defineProperty(process.versions, "node", { value: process.env.CLAUDE_SEATS_TEST_NODE }); await import(pathToFileURL(process.argv[1]));' "$@"
`,
		{ mode: executableMode },
	);
	return setup;
};

await test("the shim accepts Node 24 and newer majors", async (context: Context): Promise<void> => {
	const setup = await withVersion(context);
	await Promise.all(
		["24.0.0", "25.9.0", "26.0.0"].map(async (version): Promise<void> => {
			const result = await run(setup, ["@"], {
				env: Object.fromEntries([["CLAUDE_SEATS_TEST_NODE", version]]),
			});
			strictEqual(result.status, success, result.stderr);
			ok(result.stdout.startsWith("seat  5h"));
		}),
	);
});

await test("unsupported Node is diagnosed before loading TypeScript or dispatching a command", async (context: Context): Promise<void> => {
	const setup = await withVersion(context);
	await Promise.all(
		["20.20.2", "22.5.0", "23.0.0"].map(async (version): Promise<void> => {
			await Promise.all(
				[["@"], ["doctor"], ["install"], ["@main", "auth", "status"]].map(
					async (args: readonly string[]): Promise<void> => {
						const result = await run(setup, args, {
							env: Object.fromEntries([["CLAUDE_SEATS_TEST_NODE", version]]),
						});
						strictEqual(result.status, failure);
						strictEqual(result.stdout, "");
						strictEqual(
							result.stderr,
							`cc: Node >=24 is required (found ${version}); put Node 24 or newer on PATH and retry cc.\nreturned:1\n`,
						);
					},
				),
			);
		}),
	);
});

await test("a missing Node executable gets the same recovery step through the installed shim", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const installed = await run(setup, ["install"]);
	strictEqual(installed.status, success, installed.stderr);
	await Promise.all(
		[["doctor"], ["install"], ["@"], ["@main"]].map(
			async (args: readonly string[]): Promise<void> => {
				const result = await run(
					{
						...setup,
						shim: path.join(setup.home, ".claude-shared/bin/cc.zsh"),
					},
					args,
					{
						env: Object.fromEntries([["PATH", "/usr/bin:/bin"]]),
					},
				);
				strictEqual(result.status, failure);
				strictEqual(result.stdout, "");
				strictEqual(
					result.stderr,
					"cc: Node >=24 is required (node not found); put Node 24 or newer on PATH and retry cc.\nreturned:1\n",
				);
			},
		),
	);
});
