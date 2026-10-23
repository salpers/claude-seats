import path from "node:path";
import { editObject, parseObject } from "./json-object.ts";
import type { ConfigSnapshot } from "./project-config-file.ts";
import { readProjectFile, writeProjectFile } from "./project-config-file.ts";
import type { ProjectSyncIo } from "./sync-projects.ts";

type SettingsEdit =
	| { readonly ok: true; readonly text: string }
	| { readonly ok: false };
type SettingsResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: string };

const failure: SettingsResult = {
	ok: false,
	reason:
		"Cannot disable autoContinueAtUsageLimit in shared .claude/settings.json.",
};
const systemIo: ProjectSyncIo = {
	read: readProjectFile,
	write: async (
		file: string,
		original: ConfigSnapshot,
		text: string,
	): Promise<boolean> => writeProjectFile(file, { original, text }),
};

const failFastSettings = (text: string): SettingsEdit => {
	const parsed = parseObject(text);
	if (!parsed.ok) {
		return { ok: false };
	}
	return {
		ok: true,
		text: editObject(parsed.object, [
			{ name: "autoContinueAtUsageLimit", text: "false" },
		]),
	};
};

const alreadyDisabled = async (
	file: string,
	io: ProjectSyncIo,
): Promise<boolean> => {
	const current = await io.read(file);
	if (!(current.ok && current.exists)) {
		return false;
	}
	const edited = failFastSettings(current.text);
	return edited.ok && edited.text === current.text;
};

const retrySettings = async (
	file: string,
	original: ConfigSnapshot,
	io: ProjectSyncIo,
): Promise<boolean> => {
	const current = await io.read(file);
	if (!(current.ok && current.exists)) {
		return false;
	}
	const edited = failFastSettings(current.text);
	if (
		!edited.ok ||
		(current.exists === original.exists &&
			current.text === original.text &&
			current.mode === original.mode)
	) {
		return false;
	}
	// Accept a competing writer's update or retry once against the newer snapshot.
	return (
		edited.text === current.text ||
		(await io.write(file, current, edited.text)) ||
		(await alreadyDisabled(file, io))
	);
};

const saveSettings = async (
	file: string,
	original: ConfigSnapshot,
	io: ProjectSyncIo,
): Promise<SettingsResult> => {
	const edited = failFastSettings(original.text);
	if (!edited.ok) {
		return failure;
	}
	if (
		edited.text === original.text ||
		(await io.write(file, original, edited.text))
	) {
		return { ok: true };
	}
	if (await retrySettings(file, original, io)) {
		return { ok: true };
	}
	return failure;
};

const ensureHandoffSettings = async (
	home: string,
	io: ProjectSyncIo = systemIo,
): Promise<SettingsResult> => {
	const file = path.join(home, ".claude", "settings.json");
	try {
		const original = await io.read(file);
		if (!original.ok) {
			return failure;
		}
		return await saveSettings(file, original, io);
	} catch {
		// Config contents and filesystem diagnostics must never reach CLI output.
	}
	return failure;
};

export { ensureHandoffSettings, failFastSettings };
