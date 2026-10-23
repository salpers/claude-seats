import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { ButtonProps, Elements, UiNode } from "./api.ts";
import type { View } from "./picker.ts";
import { panelView, pickerTree } from "./picker.ts";

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
const lastThree = -3;
const unused = async (): Promise<void> => {
	await Promise.resolve();
};
const quiet = Object.freeze({ close: unused, pick: unused });

// Records what the picker asks Claude Code to draw.
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

await test("each seat is a numbered button; busy seats are dim, this session's seat is marked, 0 closes", (): void => {
	const { buttons, texts, ui } = recorder();
	pickerTree(ui, view, quiet);
	deepStrictEqual(
		buttons.map((button) => [button.hotkey, button.label, button.dimColor]),
		[
			["1", "  main  5h  0%  7d 100%", true],
			["2", "● dev2  5h 24%  7d  86%", true],
			["3", "  dev3  5h  7%  7d   2%", false],
			["0", "close", true],
		],
	);
	strictEqual(
		texts.at(last),
		"1–3 or click: move this session · ctrl+x tab: ↑↓ Enter",
	);
});

await test("pressing a row picks its seat; pressing close closes", async (): Promise<void> => {
	const { buttons, ui } = recorder();
	const pressed: string[] = [];
	pickerTree(ui, view, {
		close: (): void => {
			pressed.push("close");
		},
		pick: async (seat: string): Promise<void> => {
			pressed.push(seat);
			await Promise.resolve();
		},
	});
	const third = buttons.at(thirdRow);
	const close = buttons.at(last);
	ok(third && close);
	await third.onPress();
	close.onPress();
	deepStrictEqual(pressed, ["dev3", "close"]);
});

await test("seats past the ninth have no hotkey; loading and errors show one line", (): void => {
	const { buttons, texts, ui } = recorder();
	const many = Array.from({ length: 10 }, (_unused, index) => ({
		alert: false,
		seat: `s${String(index)}`,
		text: `s${String(index)}`,
	}));
	pickerTree(ui, { current: "s0", kind: "rows", rows: many }, quiet);
	deepStrictEqual(
		buttons.map((button) => button.hotkey ?? "none").slice(lastThree),
		["9", "none", "0"],
	);
	pickerTree(ui, { kind: "loading" }, quiet);
	pickerTree(ui, { kind: "error", reason: "Seat usage unavailable." }, quiet);
	deepStrictEqual(texts.slice(lastTwo), [
		"Reading seat usage…",
		"Seat usage unavailable.",
	]);
});
