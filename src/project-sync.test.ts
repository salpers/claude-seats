import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { ProjectConfig } from "./project-sync.ts";
import { mergeProjectConfig, parseProjectConfig } from "./project-sync.ts";

const config = (text: string): ProjectConfig => {
	const result = parseProjectConfig(text);
	ok(result.ok);
	return result.config;
};
const donor = config(`{"projects":{"/repo":{
	"hasTrustDialogAccepted":true,
	"mcpServers":{"shared":{"command":"shared"},"conflict":{"command":"donor"}},
	"allowedTools":["Read","Bash(git status)"],
	"enabledMcpjsonServers":["shared"],
	"lastCost":123
},"/other":{"allowedTools":["Write"]}},"userID":"donor"}`);

await test("imports trust and project settings, without copying identity or cost stats", (): void => {
	const expected = {
		projects: {
			"/other": { allowedTools: ["Write"] },
			"/repo": {
				allowedTools: ["Read", "Bash(git status)"],
				enabledMcpjsonServers: ["shared"],
				hasTrustDialogAccepted: true,
				mcpServers: {
					conflict: { command: "donor" },
					shared: { command: "shared" },
				},
			},
		},
	};
	const parsed: unknown = JSON.parse(mergeProjectConfig(config("{}"), [donor]));
	deepStrictEqual(parsed, expected);
});

await test("local trust and whole MCP server definitions win conflicts; lists form stable unions", (): void => {
	const local = config(
		JSON.stringify({
			projects: {
				"/repo": {
					allowedTools: ["Write", "Read"],
					enabledMcpjsonServers: ["local"],
					hasTrustDialogAccepted: false,
					mcpServers: {
						conflict: { command: "local", env: { local: "value" } },
					},
				},
			},
		}),
	);
	const merged = mergeProjectConfig(local, [donor]);
	const parsed: unknown = JSON.parse(merged);
	deepStrictEqual(parsed, {
		projects: {
			"/other": { allowedTools: ["Write"] },
			"/repo": {
				allowedTools: ["Write", "Read", "Bash(git status)"],
				enabledMcpjsonServers: ["local", "shared"],
				hasTrustDialogAccepted: false,
				mcpServers: {
					conflict: { command: "local", env: { local: "value" } },
					shared: { command: "shared" },
				},
			},
		},
	});
	strictEqual(mergeProjectConfig(config(merged), [donor, local]), merged);
});

await test("everything outside the synced values stays byte-identical, including number and escape spelling", (): void => {
	const before = String.raw`{
  "oauthAccount" : { "name": "a\u0062", "metadata": [1e+03, -0] },
  "userID": "seat", "machineID" : "machine",
  "cachedFeatureFlags": {"number":9007199254740993},
  "projects" : { "/repo" : {
    "lastCost" : 1.2300, "lastSessionId":"local", "custom": ["comma,brace}", {"nested":true}],
    "hasTrustDialogAccepted" : false,
    "allowedTools" : [ "Write" ]
  } }, "tail":null
}
`;
	const onlyTools = config('{"projects":{"/repo":{"allowedTools":["Read"]}}}');
	const after = mergeProjectConfig(config(before), [onlyTools]);
	strictEqual(after, before.replace('[ "Write" ]', '["Write","Read"]'));
	strictEqual(mergeProjectConfig(config(after), [onlyTools]), after);
});

await test("missing fields stay missing and projects with only private stats are not copied", (): void => {
	const empty = config(
		'{"projects":{"/private":{"lastCost":2}},"userID":"private"}',
	);
	strictEqual(mergeProjectConfig(config("{ }\n"), [empty]), "{ }\n");
});

await test("list unions remove duplicates while retaining local-first order", (): void => {
	const repeated = config(
		JSON.stringify({
			projects: {
				"/repo": {
					allowedTools: ["Read", "Read", "Write"],
					enabledMcpjsonServers: ["docs", "docs"],
				},
			},
		}),
	);
	const local = config(
		'{"projects":{"/repo":{"allowedTools":["Write","Write"]}}}',
	);
	for (const { destination, tools } of [
		{ destination: config("{}"), tools: ["Read", "Write"] },
		{ destination: local, tools: ["Write", "Read"] },
	]) {
		const merged = mergeProjectConfig(destination, [repeated]);
		const project = config(merged).entries.find(
			(entry) => entry.name === "/repo",
		);
		ok(project);
		const parsed: unknown = JSON.parse(project.project.text);
		deepStrictEqual(parsed, {
			allowedTools: tools,
			enabledMcpjsonServers: ["docs"],
		});
		strictEqual(mergeProjectConfig(config(merged), [repeated]), merged);
	}
});

await test("invalid JSON and malformed synced fields are rejected without reflecting content", (): void => {
	for (const text of [
		"{",
		"null",
		"[]",
		'{"projects":null}',
		'{"projects":[]}',
		'{"projects":{"/repo":null}}',
		JSON.stringify({
			projects: { "/repo": { hasTrustDialogAccepted: "private" } },
		}),
		'{"projects":{"/repo":{"allowedTools":[1]}}}',
		JSON.stringify({ projects: { "/repo": { enabledMcpjsonServers: {} } } }),
		'{"projects":{"/repo":{"mcpServers":[]}}}',
		'{"projects":{"/repo":{"mcpServers":{"invalid":null}}}}',
		'{"projects":{},"projects":{}}',
		'{"projects":{"/repo":{},"/repo":{}}}',
	]) {
		deepStrictEqual(parseProjectConfig(text), { ok: false });
	}
});

await test("unusual JSON keys are data, never inherited properties or prototype setters", (): void => {
	const unusual = config(
		'{"projects":{"__proto__":{"mcpServers":{"__proto__":{"command":"ok"},"constructor":{"command":"also-ok"}}},"constructor":{"allowedTools":["Read"]}}}',
	);
	const merged = mergeProjectConfig(config("{}"), [unusual]);
	strictEqual(merged, unusual.document.text);
	strictEqual(mergeProjectConfig(config(merged), [unusual]), merged);
});
