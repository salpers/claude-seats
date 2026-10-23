import { strictEqual } from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Context, Fixture } from "./shim-fixture.ts";
import { fixture, run } from "./shim-fixture.ts";

const success = 0;
const installedShim = (setup: Fixture): string =>
	path.join(setup.home, ".claude-shared/bin/cc.zsh");
const installFixture = async (context: Context): Promise<Fixture> => {
	const setup = await fixture(context);
	const installed = await run(setup, ["install"]);
	strictEqual(installed.status, success, installed.stderr);
	await writeFile(
		path.join(setup.home, ".zshrc"),
		'source "$CLAUDE_SEATS_HOME/.claude-shared/bin/cc.zsh"\n',
	);
	return setup;
};

// A separate interactive shell reads only the fixture's .zshrc, just like a new terminal.
const freshShell = async (
	setup: Fixture,
	args: readonly string[],
): ReturnType<typeof run> =>
	run(setup, args, {
		env: Object.fromEntries([["ZDOTDIR", setup.home]]),
		script: 'shift; exec /bin/zsh -d -i -c \'cc "$@"\' cc-test "$@"',
	});

export { freshShell, installedShim, installFixture };
