import type { ButtonProps, Elements, UiNode } from "./api.ts";

interface PanelRow {
	readonly alert: boolean;
	readonly seat: string;
	readonly text: string;
}
type View =
	| { readonly kind: "loading" }
	| { readonly kind: "error"; readonly reason: string }
	| {
			readonly current: string;
			readonly kind: "rows";
			readonly rows: readonly PanelRow[];
	  };

const success = 0;
const first = 1;
// Hotkeys are single digits, so only the first nine seats get one.
const lastHotkey = 9;

const isPanelRow = (value: unknown): value is PanelRow =>
	typeof value === "object" &&
	value !== null &&
	"alert" in value &&
	typeof value.alert === "boolean" &&
	"seat" in value &&
	typeof value.seat === "string" &&
	"text" in value &&
	typeof value.text === "string";

const parseRows = (json: string): readonly PanelRow[] | false => {
	try {
		const parsed: unknown = JSON.parse(json);
		if (Array.isArray(parsed) && parsed.every((row) => isPanelRow(row))) {
			return parsed;
		}
	} catch {
		// Reported as unreadable below.
	}
	return false;
};

// Cc answers on stdout as NUL-separated fields: "display", then the JSON.
const panelView = (
	result: Readonly<{ exitCode: number; stderr: string; stdout: string }>,
	current: string,
): View => {
	const [kind, json = ""] = result.stdout.split("\0");
	const rows = parseRows(json);
	if (result.exitCode !== success || kind !== "display" || rows === false) {
		const [line = ""] = result.stderr.trim().split("\n");
		return {
			kind: "error",
			reason: `Seat usage unavailable. ${line}`.trim(),
		};
	}
	return { current, kind: "rows", rows };
};

const hotkeyFor = (index: number): Pick<ButtonProps, "hotkey"> => {
	if (index >= lastHotkey) {
		return {};
	}
	return { hotkey: String(index + first) };
};

const marker = (row: PanelRow, current: string): string => {
	if (row.seat === current) {
		return "●";
	}
	return " ";
};

const hint = (count: number): string =>
	`1–${String(Math.min(count, lastHotkey))} or click: move this session · ctrl+x tab: ↑↓ Enter`;

const body = (
	ui: Elements,
	view: View,
	pick: (seat: string) => Promise<void>,
): readonly UiNode[] => {
	if (view.kind === "loading") {
		return [ui.Text({ children: ["Reading seat usage…"], dimColor: true })];
	}
	if (view.kind === "error") {
		return [ui.Text({ children: [view.reason] })];
	}
	return [
		...view.rows.map((row, index) =>
			ui.Button({
				dimColor: row.alert,
				key: `seat-${row.seat}`,
				label: `${marker(row, view.current)} ${row.text}`,
				onPress: async () => pick(row.seat),
				plain: true,
				...hotkeyFor(index),
			}),
		),
		ui.Text({ children: [hint(view.rows.length)], dimColor: true }),
	];
};

// One button per seat: rows the menu bar colours red are dim; ● marks this session's seat.
// The picker sits in the band above the prompt, where a bare digit in an empty prompt presses a button.
const pickerTree = (
	ui: Elements,
	view: View,
	actions: Readonly<{
		close: () => unknown;
		pick: (seat: string) => Promise<void>;
	}>,
): UiNode =>
	ui.Box({
		children: [
			...body(ui, view, actions.pick),
			ui.Button({
				dimColor: true,
				hotkey: "0",
				key: "close",
				label: "close",
				onPress: actions.close,
				plain: true,
			}),
		],
		flexDirection: "column",
	});

export type { View };
export { panelView, pickerTree };
