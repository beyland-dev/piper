import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AhpAction, AhpClient, AhpNotification } from "../src/ahp/client.js";
import { CopilotAhpHarness } from "../src/index.js";
import { AsyncQueue } from "../src/utils/async-queue.js";

class FakeAhpClient {
	readonly notifications = new AsyncQueue<AhpNotification>();
	readonly requests: Array<{ method: string; params?: unknown }> = [];
	readonly actions: Array<{ channel: string; action: AhpAction }> = [];
	readonly dispatchChannels: string[] = [];

	async request(method: string, params?: unknown): Promise<unknown> {
		this.requests.push({ method, params });
		return null;
	}

	async requestWithAuth(method: string, params?: unknown): Promise<unknown> {
		this.requests.push({ method, params });
		return null;
	}

	dispatchAction(channel: string, action: AhpAction): void {
		this.actions.push({ channel, action });
		this.dispatchChannels.push(channel);
		if (action.type !== "chat/turnStarted" || typeof action.turnId !== "string") {
			return;
		}

		this.notifications.push({
			method: "action",
			params: {
				channel,
				action: {
					type: "chat/responsePart",
					turnId: action.turnId,
					part: {
						kind: "markdown",
						content: "AHP response",
					},
				},
			},
		});
		this.notifications.push({
			method: "action",
			params: {
				channel,
				action: {
					type: "chat/turnComplete",
					turnId: action.turnId,
				},
			},
		});
	}

	close(): void {
		this.notifications.close();
	}
}

describe("CopilotAhpHarness", () => {
	const directories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			directories.map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("creates a Copilot AHP session and dispatches a chat turn", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-copilot-ahp-"));
		directories.push(workspacePath);

		const fakeClient = new FakeAhpClient();
		const adapter = new CopilotAhpHarness({
			connect: async () => fakeClient as unknown as AhpClient,
		});

		const handle = adapter.startStep({
			goal: "Create a plan",
			model: "gpt-5.4",
			context: ["Use tests"],
			workspacePath,
		});

		await expect(handle.completed).resolves.toMatchObject({
			output: "AHP response",
			modifiedFiles: [],
		});

		expect(fakeClient.requests[0]).toMatchObject({
			method: "createSession",
			params: {
				provider: "copilotcli",
				model: { id: "gpt-5.4" },
				workingDirectory: expect.stringMatching(/^file:\/\//),
			},
		});
		expect(fakeClient.requests.map((request) => request.method)).toEqual([
			"createSession",
			"createChat",
			"subscribe",
			"subscribe",
		]);
		expect(fakeClient.actions[0]).toMatchObject({
			action: {
				type: "chat/turnStarted",
				message: {
					text: expect.stringContaining("Goal:\nCreate a plan"),
				},
			},
		});
	});
});
