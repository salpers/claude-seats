import path from "node:path";
import { isRecord, parseJson } from "./json.ts";
import { editObject, memberText, parseObject } from "./json-object.ts";
import { readProjectFile, writeProjectFile } from "./project-config-file.ts";
import {
	installedStatuslineCommand,
	statuslineCommand,
} from "./statusline-runtime.ts";
import { rewrapStatuslineCommand } from "./statusline-wrapper.ts";

type SettingsEdit =
	| { readonly ok: true; readonly text: string }
	| { readonly ok: false };
const wrapStatusline = (text: string, command: string): SettingsEdit => {
	const parsed = parseObject(text);
	const value = parseJson(text);
	if (!(parsed.ok && value.ok && isRecord(value.value))) {
		return { ok: false };
	}
	const legacy = value.value["command"];
	if (value.value["type"] !== "command" || typeof legacy !== "string") {
		return { ok: false };
	}
	return {
		ok: true,
		text: editObject(parsed.object, [
			{
				name: "command",
				text: JSON.stringify(rewrapStatuslineCommand(legacy, command)),
			},
		]),
	};
};

const statuslineSettings = (
	text: string,
	command = statuslineCommand,
): SettingsEdit => {
	const parsed = parseObject(text);
	if (!parsed.ok) {
		return { ok: false };
	}
	const existing = memberText(parsed.object, "statusLine");
	let statusline: SettingsEdit = {
		ok: true,
		text: JSON.stringify({ command, type: "command" }),
	};
	if (existing !== "") {
		statusline = wrapStatusline(existing, command);
	}
	if (!statusline.ok) {
		return statusline;
	}
	return {
		ok: true,
		text: editObject(parsed.object, [
			{ name: "statusLine", text: statusline.text },
		]),
	};
};

const alreadyConfigured = async (
	file: string,
	command: string,
): Promise<boolean> => {
	const current = await readProjectFile(file);
	if (!current.ok) {
		return false;
	}
	const checked = statuslineSettings(current.text, command);
	return checked.ok && checked.text === current.text;
};

const configureStatusline = async (
	file: string,
	runtime: "installed" | "current",
): Promise<boolean> => {
	const original = await readProjectFile(file);
	if (!original.ok) {
		return false;
	}
	const command = await installedStatuslineCommand(original.text, runtime);
	const edited = statuslineSettings(original.text, command);
	if (!edited.ok) {
		return false;
	}
	if (
		edited.text === original.text ||
		(await writeProjectFile(file, { original, text: edited.text }))
	) {
		return true;
	}
	// A simultaneous launch may already have installed the identical wrapper.
	return alreadyConfigured(file, command);
};

const ensureStatuslineSettings = async (
	home: string,
	runtime: "installed" | "current" = "installed",
): Promise<boolean> =>
	configureStatusline(path.join(home, ".claude", "settings.json"), runtime);

export { ensureStatuslineSettings, statuslineSettings };
