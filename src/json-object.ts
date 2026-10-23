import { isRecord, parseJson } from "./json.ts";

interface JsonMember {
	readonly name: string;
	readonly start: number;
	readonly end: number;
	readonly text: string;
}
interface JsonObject {
	readonly text: string;
	readonly members: readonly JsonMember[];
	readonly close: number;
}
interface JsonUpdate {
	readonly name: string;
	readonly text: string;
}
type ObjectResult =
	| { readonly ok: true; readonly object: JsonObject }
	| { readonly ok: false };
type Span = Readonly<{ start: number; end: number }>;

const zero = 0;
const one = 1;
const tokenPattern = /"(?:[^"\\]|\\.)*"|[{}[\],:]/gu;
const memberPattern = /^\s*(?<key>"(?:[^"\\]|\\.)*")\s*:\s*/u;

const readMember = (text: string, span: Span): JsonMember | false => {
	const match = memberPattern.exec(text.slice(span.start, span.end));
	const { groups } = match ?? {};
	if (!(match && groups)) {
		return false;
	}
	const key = parseJson(groups["key"] ?? "");
	if (!key.ok || typeof key.value !== "string") {
		return false;
	}
	const start = span.start + match[zero].length;
	const end = span.start + text.slice(span.start, span.end).trimEnd().length;
	return { end, name: key.value, start, text: text.slice(start, end) };
};

const delimiters = function* delimiters(text: string): Generator<number> {
	let depth = zero;
	for (const token of text.matchAll(tokenPattern)) {
		const value = token[zero];
		if (value === "{" || value === "[") {
			depth += one;
		} else if (value === "}" || value === "]") {
			depth -= one;
		}
		if ((value === "," && depth === one) || (value === "}" && depth === zero)) {
			yield token.index;
		}
	}
};

const readMembers = (text: string): readonly JsonMember[] | false => {
	const members: JsonMember[] = [];
	let start = text.indexOf("{") + one;
	for (const end of delimiters(text)) {
		if (text.slice(start, end).trim() !== "") {
			const member = readMember(text, { end, start });
			if (member === false) {
				return false;
			}
			members.push(member);
		}
		start = end + one;
	}
	return members;
};

// JSON.parse validates syntax; spans let edits leave unrelated bytes untouched.
const parseObject = (text: string): ObjectResult => {
	const parsed = parseJson(text);
	if (!(parsed.ok && isRecord(parsed.value))) {
		return { ok: false };
	}
	const members = readMembers(text);
	if (
		members === false ||
		new Set(members.map((member) => member.name)).size !== members.length
	) {
		return { ok: false };
	}
	return { object: { close: text.lastIndexOf("}"), members, text }, ok: true };
};

const memberText = (
	object: JsonObject,
	name: string,
	fallback = "",
): string => {
	const member = object.members.find((entry) => entry.name === name);
	if (member) {
		return member.text;
	}
	return fallback;
};

const additionsText = (
	object: JsonObject,
	updates: readonly JsonUpdate[],
): string => {
	const names = new Set(object.members.map((member) => member.name));
	const additions = updates.filter((update) => !names.has(update.name));
	if (additions.length === zero) {
		return "";
	}
	let prefix = "";
	if (object.members.length > zero) {
		prefix = ",";
	}
	return (
		prefix +
		additions
			.map((update) => `${JSON.stringify(update.name)}:${update.text}`)
			.join(",")
	);
};

const memberTextFromUpdates = (
	updates: readonly JsonUpdate[],
	member: JsonMember,
): string => {
	const update = updates.find((entry) => entry.name === member.name);
	if (update) {
		return update.text;
	}
	return member.text;
};

const editObject = (
	object: JsonObject,
	updates: readonly JsonUpdate[],
): string => {
	const edits = object.members.map((member) => ({
		...member,
		text: memberTextFromUpdates(updates, member),
	}));
	let { text } = object;
	text =
		text.slice(zero, object.close) +
		additionsText(object, updates) +
		text.slice(object.close);
	for (const edit of edits.toReversed()) {
		text = text.slice(zero, edit.start) + edit.text + text.slice(edit.end);
	}
	return text;
};

export type { JsonMember, JsonObject, JsonUpdate, ObjectResult };
export { editObject, memberText, parseObject };
