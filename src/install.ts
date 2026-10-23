import { chmod } from "node:fs/promises";
import path from "node:path";
import type { SetupOptions, SetupReport } from "./doctor.ts";
import { failFastSettings } from "./handoff-settings.ts";
import { ensureLaunchSettings } from "./launch-settings.ts";
import { readProjectFile } from "./project-config-file.ts";
import {
	createEntry,
	inspectEntry,
	missingLinkTarget,
	privateStateDirectory,
} from "./setup-files.ts";
import type { LayoutEntry } from "./setup-layout.ts";
import { layoutProblem, setupLayout } from "./setup-layout.ts";
import { statuslineSettings } from "./statusline-settings.ts";

const zero = 0;
const directoryMode = 0o700;
const failed = (message: string): SetupReport => ({
	messages: [message],
	ok: false,
});

const checkSettings = async (home: string): Promise<readonly string[]> => {
	const settings = await readProjectFile(
		path.join(home, ".claude/settings.json"),
	);
	if (
		settings.ok &&
		statuslineSettings(settings.text).ok &&
		failFastSettings(settings.text).ok
	) {
		return [];
	}
	return [
		"Cannot safely configure hub settings.json; fix its contents or file type before cc install.",
	];
};

const preflight = async (options: SetupOptions): Promise<SetupReport> => {
	const entries = setupLayout(options.home, options.state, options.names);
	const targets = new Set([
		path.resolve(options.home, ".claude/settings.json"),
		...entries
			.filter((entry) => entry.kind !== "link")
			.map((entry) => path.resolve(entry.file)),
	]);
	const results = await Promise.all(
		entries.map(async (entry): Promise<readonly string[]> => {
			if ((await inspectEntry(entry)) === "conflict") {
				// Only targets created by this installer can make a dangling link usable.
				if (
					entry.kind === "link" &&
					targets.has(path.resolve(entry.target)) &&
					(await missingLinkTarget(entry))
				) {
					return [];
				}
				return [
					`${layoutProblem(entry)} Existing data was left in place; reconcile it before retrying cc install.`,
				];
			}
			return [];
		}),
	);
	const messages = results.flat();
	if (messages.length === zero) {
		messages.push(...(await checkSettings(options.home)));
	}
	return { messages, ok: messages.length === zero };
};

// Parent directories and settings must exist before their dependent entries are published.
const installEntries = async (
	entries: readonly LayoutEntry[],
): Promise<SetupReport> => {
	const [entry, ...rest] = entries;
	if (!entry) {
		return { messages: [], ok: true };
	}
	if ((await inspectEntry(entry)) !== "ready" && !(await createEntry(entry))) {
		return failed(
			`Cannot install ${entry.label} at ${JSON.stringify(entry.file)}; check permissions and existing data.`,
		);
	}
	return installEntries(rest);
};

const configure = async (options: SetupOptions): Promise<SetupReport> => {
	try {
		await chmod(options.state, directoryMode);
	} catch {
		return failed(
			"Cannot make the state directory private (mode 0700); check permissions.",
		);
	}
	if (!(await privateStateDirectory(options.state))) {
		return failed(
			"The state directory is not readable and writable; check permissions.",
		);
	}
	const configured = await ensureLaunchSettings(options.home, "current");
	if (!configured.ok) {
		return failed(configured.reason);
	}
	return installEntries(
		setupLayout(options.home, options.state, options.names).filter(
			(entry) => entry.kind === "link",
		),
	);
};

const install = async (options: SetupOptions): Promise<SetupReport> => {
	const checked = await preflight(options);
	if (!checked.ok) {
		return checked;
	}
	const prepared = await installEntries(
		setupLayout(options.home, options.state, options.names).filter(
			(entry) => entry.kind !== "link",
		),
	);
	if (!prepared.ok) {
		return prepared;
	}
	const configured = await configure(options);
	if (!configured.ok) {
		return configured;
	}
	return {
		messages: [
			"Installed cc and shared settings. Add the documented source line to .zshrc, then run cc doctor.",
		],
		ok: true,
	};
};

export { install };
