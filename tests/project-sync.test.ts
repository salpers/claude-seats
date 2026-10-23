import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { seedRouting } from "./routing-fixture.ts";
import type { Context, Fixture } from "./shim-fixture.ts";
import { assertLaunch, fixture, run } from "./shim-fixture.ts";

const success = 0;
const configFiles = (home: string): readonly string[] => [
	path.join(home, ".claude.json"),
	...["dev", "dev2", "dev3"].map((name) =>
		path.join(home, `.claude-${name}`, ".claude.json"),
	),
];

const seedConfigs = async (setup: Fixture): Promise<void> => {
	await Promise.all(
		configFiles(setup.home).map(async (file): Promise<void> => {
			await mkdir(path.dirname(file), { recursive: true });
			await writeFile(file, "{}");
		}),
	);
	await Promise.all([
		writeFile(
			path.join(setup.home, ".claude-dev/.claude.json"),
			JSON.stringify({
				projects: {
					"/repo": { allowedTools: ["Read"], hasTrustDialogAccepted: true },
				},
			}),
		),
		writeFile(
			path.join(setup.home, ".claude-dev2/.claude.json"),
			'{"projects":{"/repo":{"mcpServers":{"docs":{"command":"shared"}},"enabledMcpjsonServers":["docs"]}}}',
		),
		writeFile(
			path.join(setup.home, ".claude-dev3/.claude.json"),
			'{"projects":{"/repo":{"mcpServers":{"docs":{"command":"local"}}}}}',
		),
	]);
};
// The fake executable checks the files at startup, before the test can inspect them.
const checkingClaude = `#!/bin/zsh -f
exec node --input-type=module -e '
import { readFileSync } from "node:fs";
import path from "node:path";
const home = process.env.HOME;
for (const dir of [home, ...["dev", "dev2", "dev3"].map(name => path.join(home, ".claude-" + name))]) {
  const project = JSON.parse(readFileSync(path.join(dir, ".claude.json"), "utf8")).projects["/repo"];
  if (project.hasTrustDialogAccepted !== true) process.exit(41);
  if (project.allowedTools[0] !== "Read" || project.enabledMcpjsonServers[0] !== "docs") process.exit(42);
  if (project.mcpServers.docs.command !== (dir.endsWith(".claude-dev3") ? "local" : "shared")) process.exit(43);
}
'
`;
const assertSyncedLaunch = async (
	setup: Fixture,
	args: readonly string[],
): Promise<void> => {
	const result = await run(setup, args);
	strictEqual(result.status, success, result.stderr);
	let name = "main";
	if (args.includes("@dev3")) {
		name = "dev3";
	}
	strictEqual(result.stderr, `cc: using ${name}\nreturned:0\n`);
};

const fileSnapshot = async (
	file: string,
): Promise<Readonly<{ ino: bigint; modified: bigint; text: string }>> => {
	const info = await stat(file, { bigint: true });
	return {
		ino: info.ino,
		modified: info.mtimeNs,
		text: await readFile(file, "utf8"),
	};
};

await test("bare cc syncs all four seats before exec; @dev3 sees trust, MCP and tool settings", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await seedConfigs(setup);
	await seedRouting(setup);
	await writeFile(setup.binary, checkingClaude);
	await assertSyncedLaunch(setup, []);
	const before = await Promise.all(
		configFiles(setup.home).map(async (file) => fileSnapshot(file)),
	);
	await assertSyncedLaunch(setup, ["@dev3"]);
	deepStrictEqual(
		await Promise.all(
			configFiles(setup.home).map(async (file) => fileSnapshot(file)),
		),
		before,
	);
});

await test("an unreadable seat is reported and skipped while launch and other seats' sync proceed", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await mkdir(path.join(setup.home, ".claude-dev2/.claude.json"), {
		recursive: true,
	});
	await writeFile(
		path.join(setup.home, ".claude.json"),
		JSON.stringify({ projects: { "/repo": { hasTrustDialogAccepted: true } } }),
	);
	const result = await run(setup, ["@dev3", "prompt"]);
	strictEqual(result.status, success, result.stderr);
	strictEqual(
		result.stderr,
		"cc: Project sync skipped dev2: unreadable config.\ncc: using dev3\nreturned:0\n",
	);
	assertLaunch(result.stdout, [
		"set",
		path.join(setup.home, ".claude-dev3"),
		"prompt",
	]);
	const text = await readFile(
		path.join(setup.home, ".claude-dev3/.claude.json"),
		"utf8",
	);
	const parsed: unknown = JSON.parse(text);
	deepStrictEqual(parsed, {
		projects: { "/repo": { hasTrustDialogAccepted: true } },
	});
});

await test("listing and invalid selectors leave project files untouched", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const file = path.join(setup.home, ".claude.json");
	await writeFile(file, "malformed private config");
	await Promise.all(
		[["@"], ["@unknown"]].map(
			async (args: readonly string[]): Promise<void> => {
				const result = await run(setup, args);
				strictEqual(result.stderr.includes("Project sync"), false);
				strictEqual(await readFile(file, "utf8"), "malformed private config");
			},
		),
	);
});
