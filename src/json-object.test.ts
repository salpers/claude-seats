import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { JsonObject } from "./json-object.ts";
import { editObject, memberText, parseObject } from "./json-object.ts";

const object = (text: string): JsonObject => {
	const parsed = parseObject(text);
	ok(parsed.ok);
	return parsed.object;
};

await test("edits handle escaped keys, strings containing JSON punctuation, and nested arrays without changing other bytes", (): void => {
	const before = String.raw`{
 "keep": [false, null, 1e+02, {"quote": "\"},[{", "slash": "\\"}],
 "\u0074arget": {"nested": [1, 2]},
 "after": -0
}
`;
	const parsed = object(before);
	strictEqual(memberText(parsed, "target"), '{"nested": [1, 2]}');
	strictEqual(
		editObject(parsed, [{ name: "target", text: "true" }]),
		before.replace('{"nested": [1, 2]}', "true"),
	);
	strictEqual(editObject(parsed, []), before);
});

await test("adding properties to empty and populated objects preserves surrounding whitespace", (): void => {
	strictEqual(
		editObject(object("{ \n}\n"), [{ name: "new", text: "[]" }]),
		'{ \n"new":[]}\n',
	);
	strictEqual(
		editObject(object('{ "old" : 1 \n}\n'), [{ name: "new", text: "[]" }]),
		'{ "old" : 1 \n,"new":[]}\n',
	);
});

await test("duplicate decoded keys and malformed syntax are rejected", (): void => {
	for (const text of [
		String.raw`{"key":1,"\u006bey":2}`,
		'{"key":1,}',
		'{"key":1} false',
		"null",
		"[]",
	]) {
		deepStrictEqual(parseObject(text), { ok: false });
	}
});
