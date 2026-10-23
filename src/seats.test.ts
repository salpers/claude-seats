import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { createSeats } from "./seats.ts";

await test("the registry contains only the four seats and their known keychain slots", (): void => {
	deepStrictEqual(createSeats("/Users/me"), [
		{
			directory: "/Users/me/.claude",
			name: "main",
			slot: "Claude Code-credentials",
		},
		{
			directory: "/Users/me/.claude-dev",
			name: "dev",
			slot: "Claude Code-credentials-9cb3e83e",
		},
		{
			directory: "/Users/me/.claude-dev2",
			name: "dev2",
			slot: "Claude Code-credentials-374e2450",
		},
		{
			directory: "/Users/me/.claude-dev3",
			name: "dev3",
			slot: "Claude Code-credentials-6f316b21",
		},
	]);
});

await test("seat paths and slot hashes follow the overridden home", (): void => {
	const seats = createSeats("/tmp/seat home/");
	const [main, , dev2] = seats;
	ok(main && dev2);
	strictEqual(main.directory, "/tmp/seat home/.claude");
	strictEqual(main.slot, "Claude Code-credentials");
	strictEqual(dev2.directory, "/tmp/seat home/.claude-dev2");
	strictEqual(dev2.slot, "Claude Code-credentials-720971ec");
	strictEqual(
		seats.some((seat) => seat.directory.endsWith(".claude-api")),
		false,
	);
});
