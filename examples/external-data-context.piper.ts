import { agent, artifact, input, loop, step } from "@beyland/piper";

type SupportTicket = {
	id: string;
	account: string;
	severity: "low" | "medium" | "high";
	summary: string;
	observedBehavior: string;
};

async function fetchSupportTicket(id: string): Promise<SupportTicket> {
	return {
		id,
		account: "Northwind Checkout",
		severity: "high",
		summary: "Checkout retries fail after token refresh.",
		observedBehavior:
			"Customers can recover by refreshing manually, but automated retries keep using the stale token.",
	};
}

function formatTicket(ticket: SupportTicket): string {
	return [
		`Source: support ticket ${ticket.id}`,
		`Account: ${ticket.account}`,
		`Severity: ${ticket.severity}`,
		`Summary: ${ticket.summary}`,
		`Observed behavior: ${ticket.observedBehavior}`,
	].join("\n");
}

const escalationContext = input(
	"checkout-escalation-ticket",
	async () => formatTicket(await fetchSupportTicket("ESC-1842")),
	{ description: "formatted checkout escalation ticket" },
);
const plan = artifact("escalation-response-plan", "plan");

export default loop(
	{
		objective: "Plan a checkout escalation response from external support data",
		agents: [agent("planner", { harness: "copilot" })],
	},
	step({
		role: "planner",
		goal: "Create a response plan grounded in the escalation ticket.",
		context: [escalationContext],
		produces: plan,
	}),
);
