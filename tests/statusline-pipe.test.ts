import { strictEqual } from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import type { Context } from "./shim-fixture.ts";
import { fixture } from "./shim-fixture.ts";

const success = 0;
const timeout = 5000;
const root = path.dirname(import.meta.dirname);

await Promise.all(
	["statusline-cli.ts", "statusline-cli.mjs"].map(
		async (entrypoint): Promise<void> => {
			await test(`${entrypoint}: a closed statusline reader exits quietly`, async (context: Context): Promise<void> => {
				const setup = await fixture(context);
				const child = spawn(
					process.execPath,
					[path.join(root, "src", entrypoint)],
					{
						env: Object.fromEntries([
							["CLAUDE_SEATS_STATE_DIR", path.join(setup.directory, "state")],
							["HOME", setup.home],
						]),
						timeout,
					},
				);
				let stderr = "";
				child.stderr.setEncoding("utf8").on("data", (chunk: string): void => {
					stderr += chunk;
				});
				child.stdout.destroy();
				child.stdin.end("{}");
				await once(child, "close");
				strictEqual(child.exitCode, success, stderr);
				strictEqual(stderr, "");
			});
		},
	),
);
