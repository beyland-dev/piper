import { describe, expect, it } from "vitest";
import { buildDefaultChatUri, extractAgentHostAddress } from "../src/ahp/client.js";

describe("AHP client helpers", () => {
	it("builds VS Code default chat URIs from session URIs", () => {
		expect(buildDefaultChatUri("copilotcli:/123")).toBe(
			"ahp-chat://default/Y29waWxvdGNsaTovMTIz",
		);
	});

	it("extracts the Agent Host WebSocket address from CLI output", () => {
		const output = "\u001b[32mLocal ws://localhost:41234?tkn=secret-token\u001b[0m";
		expect(extractAgentHostAddress(output)).toBe("ws://localhost:41234?tkn=secret-token");
	});
});
