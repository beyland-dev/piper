import { Task, derive, output } from "agent-runtime";

async function fetchPackageContext(packageName: string) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`);

  if (!response.ok) {
    return `Unable to fetch npm registry metadata for ${packageName}: ${response.status} ${response.statusText}`;
  }

  const metadata = (await response.json()) as {
    "dist-tags"?: Record<string, string>;
    time?: Record<string, string>;
    description?: string;
  };
  const latestVersion = metadata["dist-tags"]?.latest;

  return [
    `Package: ${packageName}`,
    `Description: ${metadata.description ?? "unknown"}`,
    `Latest version: ${latestVersion ?? "unknown"}`,
    `Latest publish time: ${(latestVersion && metadata.time?.[latestVersion]) || "unknown"}`
  ].join("\n");
}

export default function DependencyIntelligenceWorkflow() {
  return (
    <>
      <Task
        goal="Prepare dependency upgrade context from external registry data"
        agent="pi"
        context={[
          derive(() => fetchPackageContext("typescript"), "TypeScript npm registry context"),
          derive(() => fetchPackageContext("vitest"), "Vitest npm registry context"),
          "Compare registry data against the current repository constraints before recommending changes."
        ]}
        output="dependency-intelligence"
      />

      <Task
        goal="Plan a safe dependency update using the fetched package intelligence"
        agent="pi"
        context={[
          output("dependency-intelligence"),
          "Call out compatibility risks, validation commands, and whether the update should be deferred."
        ]}
        output="dependency-update-plan"
      />

      <Task
        goal="Run the dependency update plan through a final risk review"
        agent="pi"
        context={[
          output("dependency-update-plan"),
          "Do not update dependencies automatically unless the plan says the risk is low and validation is clear."
        ]}
        validate={[
          derive(async ({ readOutput }) => (await readOutput("dependency-update-plan")).toLowerCase().includes("validation"), "plan includes validation guidance")
        ]}
      />
    </>
  );
}
