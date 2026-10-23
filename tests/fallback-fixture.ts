import { ok, strictEqual } from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { seedRouting } from "./routing-fixture.ts";
import type { Context, Fixture } from "./shim-fixture.ts";
import { assertLaunch, fixture, run } from "./shim-fixture.ts";
import { installCredentials, synthetic } from "./usage-table-fixture.ts";

const fetchedPattern = /"fetchedAt":\d+/u;
const minuteMs = 60_000;
const privateMode = 0o600;
const modeBase = 0o1000;
const success = 0;
const one = 1;
const stateDirectory = (setup: Fixture): string =>
	path.join(setup.directory, "state");
const ageCache = async (setup: Fixture, minutes: number): Promise<void> => {
	await Promise.all(
		["main", "dev", "dev2", "dev3"].map(async (name): Promise<void> => {
			const file = path.join(stateDirectory(setup), `usage-${name}.json`);
			const text = await readFile(file, "utf8");
			await writeFile(
				file,
				text.replace(
					fetchedPattern,
					`"fetchedAt":${Date.now() - minutes * minuteMs}`,
				),
			);
		}),
	);
};
const installProbe = async (setup: Fixture): Promise<void> => {
	const original = await readFile(setup.binary, "utf8");
	const script = `
if [[ "$1" == -p ]]; then
  [[ "$2" == Hi && "$3" == --model && "$4" == haiku ]] || exit 9
  seat=main
  if [[ -n "$CLAUDE_CONFIG_DIR" ]]; then seat="\${CLAUDE_CONFIG_DIR##*.claude-}"; fi
  print -r -- "$seat" >> "$CLAUDE_SEATS_STATE_DIR/probes.log"
  if [[ -n "$CLAUDE_SEATS_TEST_PROBE_DELAY" ]]; then sleep "$CLAUDE_SEATS_TEST_PROBE_DELAY"; fi
  if [[ "$CLAUDE_SEATS_TEST_LIMIT" == all || "$seat" == "$CLAUDE_SEATS_TEST_LIMIT" ]]; then
    print -r -- "hit your session limit · resets 13:50" >&2
    exit 1
  fi
  if [[ "$CLAUDE_SEATS_TEST_PROBE_FAIL" == yes ]]; then
    print -r -- 'private diagnostic' >&2
    exit 1
  fi
  print -r -- Hello
  exit 0
fi
`;
	await writeFile(
		setup.binary,
		original.replace("#!/bin/zsh -f\n", `#!/bin/zsh -f\n${script}`),
	);
};
const setupFallback = async (context: Context): Promise<Fixture> => {
	const setup = await fixture(context);
	await mkdir(stateDirectory(setup));
	await installCredentials(setup);
	await installProbe(setup);
	return setup;
};
const probes = async (setup: Fixture): Promise<readonly string[]> => {
	const text = await readFile(
		path.join(stateDirectory(setup), "probes.log"),
		"utf8",
	);
	return text.trim().split("\n");
};
const cacheFixture = async (
	context: Context,
	minutes: number,
): Promise<Fixture> => {
	const setup = await setupFallback(context);
	await seedRouting(setup);
	await installCredentials(setup);
	await ageCache(setup, minutes);
	return setup;
};
const assertNextFallback = async (
	setup: Fixture,
	name: string,
): Promise<void> => {
	// Expire reservations to exercise the persistent cursor independently of claims.
	await writeFile(path.join(stateDirectory(setup), "claims.json"), "[]");
	const result = await run(setup, [], {
		env: Object.fromEntries([["CLAUDE_SEATS_TEST_LIMIT", "main"]]),
	});
	strictEqual(result.status, success, result.stderr);
	ok(result.stderr.includes("fallback"));
	assertLaunch(result.stdout, [
		"set",
		path.join(setup.home, `.claude-${name}`),
	]);
};
const assertSafeState = async (setup: Fixture): Promise<void> => {
	const calls = await probes(setup);
	strictEqual(calls.filter((name) => name === "main").length, one);
	const file = path.join(stateDirectory(setup), "fallback.json");
	const info = await stat(file);
	strictEqual(info.mode % modeBase, privateMode);
	await Promise.all(
		["fallback.json", "decisions.log"].map(async (name): Promise<void> => {
			const text = await readFile(
				path.join(stateDirectory(setup), name),
				"utf8",
			);
			strictEqual(text.includes(synthetic), false);
			strictEqual(text.includes("hit your session"), false);
		}),
	);
};
const assertRotation = async (setup: Fixture): Promise<void> => {
	await assertNextFallback(setup, "dev");
	await assertNextFallback(setup, "dev2");
	await assertNextFallback(setup, "dev3");
	await assertNextFallback(setup, "dev");
	await assertSafeState(setup);
};

export { assertRotation, cacheFixture, probes, setupFallback, stateDirectory };
