import { Task, useOutput } from "agent-runtime";

import { WithDesignSystemAudit } from "./shared-tasks/with-design-system-audit.js";
import { WithTests } from "./shared-tasks/with-tests.js";

export default function DesignSystemAdherenceWorkflow() {
  return (
    <WithTests testCommand="pnpm test -- design-system">
      <>
        <WithDesignSystemAudit
          designSystemDocs={["docs/design-system.md", "packages/ui/tokens.ts", "packages/ui/button.tsx"]}
          protectedFiles={["packages/ui/tokens.ts", "packages/ui/theme.css"]}
          auditGoal="Audit the checkout UI changes for design system adherence before handoff"
          auditOutput="checkout-design-system-audit"
        >
          <Task
            goal="Normalize the checkout screen to existing design system components"
            agent="pi"
            context={[
              "Prefer existing Button, Card, FormField, and Alert primitives over custom CSS.",
              "Keep token definitions unchanged unless the audit explicitly calls for a separate design system proposal."
            ]}
            output="checkout-ui-normalization"
          />
        </WithDesignSystemAudit>

        <Task
          goal="Create follow-up tickets from the design system audit findings"
          agent="pi"
          context={[
            useOutput("checkout-design-system-audit"),
            "Group related adherence issues and include recommended system primitives."
          ]}
        />
      </>
    </WithTests>
  );
}
