# Roadmap

## Declarative task environments and sandboxes

Piper already lets workflow authors declaratively describe task orchestration: which agent
harness should run, what context it receives, which artifacts it publishes, and which
guardrails apply. A natural next step is letting workflows also describe the supporting
tooling, sandbox, and development environment that each task should run inside.

The goal is to keep Piper's core mental model intact:

1. workflows describe work
2. the runtime executes the workflow tree
3. harnesses invoke coding agents
4. environments describe the execution substrate those harnesses run within

### Direction

Make task environments a first-class declarative layer beside `task`, `protect`, and
harness selection.

Workflow authors should eventually be able to define reusable environment profiles for
things like:

1. language/runtime versions
2. package managers and setup commands
3. required tools
4. environment variables
5. command wrappers
6. filesystem isolation
7. network policy
8. cache and persistence behavior
9. Docker or devcontainer-backed execution

Tasks could reference those profiles directly, while workflows or scoped blocks could
provide defaults inherited by child tasks.

### Possible authoring shape

The exact API should be designed later, but the broad shape could include:

1. a task-level `environment` or `sandbox` option
2. reusable named environment definitions
3. a scoped builder such as `withEnvironment(...)`
4. workflow-level defaults that child tasks inherit unless overridden

This would let workflows say which agent should do the work and which environment that
agent should receive.

### Runtime integration

The runtime should resolve a task's environment before starting the harness. The resolved
environment context can then be passed into `HarnessAdapter.startTask` alongside the
existing task goal, model, context, constraints, protected files, and workspace path.

Harnesses should remain focused on agents. Environments should prepare, wrap, or isolate
where the harness runs rather than replace harness behavior.

### Incremental implementation path

Start with a small command-based environment model:

1. setup command
2. task command wrapper
3. environment variables
4. working directory behavior

This maps cleanly to the existing command harness implementation and avoids committing to
a full sandbox runtime too early.

Later iterations can add richer backends:

1. Docker-backed task execution
2. devcontainer-backed task execution
3. prebuilt tool images
4. per-task filesystem isolation
5. network restrictions
6. MCP/tool allowlists
7. cache volumes and artifact persistence controls

### Design constraints

1. Keep the workflow authoring surface declarative.
2. Keep harnesses agent-focused.
3. Avoid making Piper a hidden planner or package manager.
4. Prefer composable profiles over one-off task configuration.
5. Make the first implementation useful without requiring Docker or devcontainers.
