import { isRecord, parseJson } from "./json.ts";
import type {
	JsonMember,
	JsonObject,
	JsonUpdate,
	ObjectResult,
} from "./json-object.ts";
import { editObject, memberText, parseObject } from "./json-object.ts";

interface ProjectEntry {
	readonly name: string;
	readonly project: JsonObject;
}
interface ProjectConfig {
	readonly document: JsonObject;
	readonly projects: JsonObject;
	readonly entries: readonly ProjectEntry[];
}
type ConfigResult =
	| { readonly ok: true; readonly config: ProjectConfig }
	| { readonly ok: false };
const fields = {
	allowedTools: "list",
	enabledMcpjsonServers: "list",
	hasTrustDialogAccepted: "trust",
	mcpServers: "servers",
};
const zero = 0;

const strings = (text: string): readonly string[] | false => {
	const parsed = parseJson(text);
	if (
		parsed.ok &&
		Array.isArray(parsed.value) &&
		parsed.value.every(
			(entry: unknown): entry is string => typeof entry === "string",
		)
	) {
		return parsed.value;
	}
	return false;
};

const validServers = (text: string): boolean => {
	const parsed = parseObject(text);
	if (!parsed.ok) {
		return false;
	}
	return parsed.object.members.every((member) => {
		const value = parseJson(member.text);
		return value.ok && isRecord(value.value);
	});
};

const validField = (kind: string, text: string): boolean => {
	if (text === "") {
		return true;
	}
	if (kind === "trust") {
		return text === "true" || text === "false";
	}
	if (kind === "servers") {
		return validServers(text);
	}
	return strings(text) !== false;
};

const parseProject = (text: string): ObjectResult => {
	const parsed = parseObject(text);
	if (
		!(
			parsed.ok &&
			Object.entries(fields).every(([field, kind]: readonly [string, string]) =>
				validField(kind, memberText(parsed.object, field)),
			)
		)
	) {
		return { ok: false };
	}
	return parsed;
};

const projectEntries = (
	members: readonly JsonMember[],
): readonly ProjectEntry[] | false => {
	const entries: ProjectEntry[] = [];
	for (const member of members) {
		const parsed = parseProject(member.text);
		if (!parsed.ok) {
			return false;
		}
		entries.push({ name: member.name, project: parsed.object });
	}
	return entries;
};

const parseProjectConfig = (text: string): ConfigResult => {
	const document = parseObject(text);
	if (!document.ok) {
		return { ok: false };
	}
	const projects = parseObject(memberText(document.object, "projects", "{}"));
	if (!projects.ok) {
		return { ok: false };
	}
	const entries = projectEntries(projects.object.members);
	if (entries === false) {
		return { ok: false };
	}
	return {
		config: { document: document.object, entries, projects: projects.object },
		ok: true,
	};
};

const validatedObject = (text: string): JsonObject => {
	const parsed = parseObject(text);
	if (!parsed.ok) {
		throw new TypeError("Expected validated object");
	}
	return parsed.object;
};

const mergeServers = (local: string, remote: string): string => {
	const own = validatedObject(local);
	const other = validatedObject(remote);
	const names = new Set(own.members.map((member) => member.name));
	return editObject(
		own,
		other.members.filter((member) => !names.has(member.name)),
	);
};

const mergeList = (local: string, remote: string): string => {
	const own = strings(local);
	const other = strings(remote);
	if (own === false || other === false) {
		throw new TypeError("Expected validated string lists");
	}
	const union = [...new Set([...own, ...other])];
	if (
		union.length === own.length &&
		union.every((entry, index) => entry === own[index])
	) {
		return local;
	}
	return JSON.stringify(union);
};

const mergeField = (kind: string, local: string, remote: string): string => {
	if (kind === "list") {
		return mergeList(local || "[]", remote);
	}
	if (local === "") {
		return remote;
	}
	if (kind === "trust") {
		return local;
	}
	return mergeServers(local, remote);
};

const mergeProject = (
	local: JsonObject,
	sources: readonly JsonObject[],
): string => {
	const updates = new Map<string, string>();
	for (const source of sources) {
		for (const [field, kind] of Object.entries(fields)) {
			const remote = memberText(source, field);
			if (remote !== "") {
				const own = updates.get(field) ?? memberText(local, field);
				updates.set(field, mergeField(kind, own, remote));
			}
		}
	}
	return editObject(
		local,
		[...updates].map(([name, text]: readonly [string, string]) => ({
			name,
			text,
		})),
	);
};

const mergeEntry = (
	local: ProjectConfig,
	name: string,
	sources: readonly ProjectConfig[],
): JsonUpdate => {
	const own = validatedObject(memberText(local.projects, name, "{}"));
	const projects = sources.flatMap((source) =>
		source.entries
			.filter((entry) => entry.name === name)
			.map((entry) => entry.project),
	);
	return { name, text: mergeProject(own, projects) };
};

const mergeProjectConfig = (
	local: ProjectConfig,
	sources: readonly ProjectConfig[],
): string => {
	const names = new Set(
		sources.flatMap((source) => source.entries.map((entry) => entry.name)),
	);
	const updates = [...names]
		.map((name) => mergeEntry(local, name, sources))
		.filter(
			(update) => update.text !== memberText(local.projects, update.name, "{}"),
		);
	if (updates.length === zero) {
		return local.document.text;
	}
	return editObject(local.document, [
		{ name: "projects", text: editObject(local.projects, updates) },
	]);
};

export type { ConfigResult, ProjectConfig };
export { mergeProjectConfig, parseProjectConfig };
