import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { ButtonProps, Elements, UiNode } from "./api.ts";
import type { View } from "./pane.ts";
import { panelView, paneTree } from "./pane.ts";

const rows = [
	{ alert: true, seat: "main", text: "main  5h  0%  7d 100%" },
	{ alert: true, seat: "dev2", text: "dev2  5h 24%  7d  86%" },
	{ alert: false, seat: "dev3", text: "dev3  5h  7%  7d   2%" },
];
const view: View = { current: "dev2", kind: "rows", rows };
const unreadable = JSON.stringify([{}]);
const last = -1;
const thirdRow = 2;
const lastTwo = -2;
const unused = async (): Promise<void> => {
	await Promise.resolve();
};

// Records what the pane asks Claude Code to draw.
const recorder = (): Readonly<{
	buttons: ButtonProps[];
	texts: string[];
	ui: Elements;
}> => {
	const buttons: ButtonProps[] = [];
	const texts: string[] = [];
	const ui: Elements = {
		Box: (): UiNode => ({}),
		Button: (props: ButtonProps): UiNode => {
			buttons.push(props);
			return {};
		},
		Text: (props: Readonly<{ children: readonly string[] }>): UiNode => {
			texts.push(props.children.join(""));
			return {};
		},
	};
	return { buttons, texts, ui };
};

await test("cc panel output becomes rows; a failed or unreadable run becomes a message", (): void => {
	const stdout = `display\0${JSON.stringify(rows)}\0`;
	deepStrictEqual(panelView({ exitCode: 0, stderr: "", stdout }, "dev2"), view);
	deepStrictEqual(
		panelView({ exitCode: 1, stderr: "cc: bad seats.json\n", stdout }, "dev2"),
		{ kind: "error", reason: "Seat usage unavailable. cc: bad seats.json" },
	);
	deepStrictEqual(
		panelView(
			{ exitCode: 0, stderr: "", stdout: `display\0${unreadable}\0` },
			"dev2",
		),
		{ kind: "error", reason: "Seat usage unavailable." },
	);
});

await test("each seat is a numbered button; busy seats are dim and this session's seat is marked", (): void => {
	const { buttons, texts, ui } = recorder();
	paneTree(ui, view, unused);
	deepStrictEqual(
		buttons.map((button) => [button.hotkey, button.label, button.dimColor]),
		[
			["1", "  main  5h  0%  7d 100%", true],
			["2", "● dev2  5h 24%  7d  86%", true],
			["3", "  dev3  5h  7%  7d   2%", false],
		],
	);
	strictEqual(
		texts.at(last),
		"1–3 or click: move this session · ↑↓ Enter · Esc: close",
	);
});

await test("pressing a row picks its seat", async (): Promise<void> => {
	const { buttons, ui } = recorder();
	const picked: string[] = [];
	paneTree(ui, view, async (seat: string): Promise<void> => {
		picked.push(seat);
		await Promise.resolve();
	});
	const third = buttons.at(thirdRow);
	ok(third);
	await third.onPress();
	deepStrictEqual(picked, ["dev3"]);
});

await test("seats past the ninth have no hotkey; loading and errors show one line", (): void => {
	const { buttons, texts, ui } = recorder();
	const many = Array.from({ length: 10 }, (_unused, index) => ({
		alert: false,
		seat: `s${String(index)}`,
		text: `s${String(index)}`,
	}));
	paneTree(ui, { current: "s0", kind: "rows", rows: many }, unused);
	deepStrictEqual(
		buttons.map((button) => button.hotkey ?? "none").slice(lastTwo),
		["9", "none"],
	);
	paneTree(ui, { kind: "loading" }, unused);
	paneTree(ui, { kind: "error", reason: "Seat usage unavailable." }, unused);
	deepStrictEqual(texts.slice(lastTwo), [
		"Reading seat usage…",
		"Seat usage unavailable.",
	]);
});
