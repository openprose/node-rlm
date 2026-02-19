export const EXECUTE_CODE_TOOL = {
  type: "function" as const,
  function: {
    name: "execute_code",
    description:
      "Execute JavaScript in a persistent Node.js REPL. console.log() output is returned. Call return(value) to produce your final answer.",
    parameters: {
      type: "object" as const,
      properties: {
        code: { type: "string" as const, description: "JavaScript code to execute" },
      },
      required: ["code"],
    },
  },
};

export const TOOL_CHOICE = {
  type: "function" as const,
  function: { name: "execute_code" },
};

export interface BuildSystemPromptOptions {
  canDelegate: boolean;
  invocationId: string;
  parentId: string | null;
  depth: number;
  maxDepth: number;
  maxIterations: number;
  lineage: readonly string[];
  programContent?: string;
  globalDocs?: string;
  modelTable?: string;
}

export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  const {
    canDelegate,
    invocationId,
    parentId,
    depth,
    maxDepth,
    maxIterations,
    lineage,
    programContent,
    globalDocs,
    modelTable,
  } = options;

  const sections: string[] = [];

  // 1. Preamble — Identity + Interpreter (always present, identical at all depths)
  sections.push(`<rlm-preamble>
You are an RLM -- a Recursive Language Model. You are a general-purpose computer: a while loop, a language model, and a JavaScript sandbox. You run a new kind of meta-program that composes a tree of component RLMs to solve tasks.

You write JavaScript using the execute_code tool. Each response produces one tool call. You see the output. Repeat until you call \`return(answer)\`.

Your system prompt may contain a PROGRAM -- structured prose with contracts, state schemas, and delegation patterns. Programs use these constructs:

- **Contracts** (\`ensures:\` / \`requires:\`): postconditions and preconditions. Satisfy all of them.
- **State schemas**: typed data structures. A name prefixed with \`&\` (e.g. \`&GameKnowledge\`) lives in the sandbox as a \`__camelCase\` variable (e.g. \`__gameKnowledge\`). Read and write it directly.
- **Shape declarations** (\`shape:\`): define what you do directly vs. what you delegate. \`prohibited\` lists APIs you must NOT call -- delegate those to children instead.
- **Delegation patterns**: describe which child agents to spawn via \`rlm()\` and what state to pass.
- **Strategies**: prioritized options with trigger conditions. Select based on current state.
- **Capabilities**: specifications for utility functions. You implement them. Run the \`verify\` checks.
- **Component catalogs**: declare available components with \`requires from caller\` / \`produces for caller\` contracts. Check these before delegating.
- **Composition vocabulary**: named composition styles (e.g. \`direct\`, \`coordinated\`). Select based on observable state -- budget, depth headroom, knowledge completeness. You are the intelligent container; composition decisions are yours.
- Implementation code in programs is illustrative. Write better code if you can.
- Delegation briefs and curation steps are **interfaces**, not illustrative code. Follow them precisely -- read from state, do not substitute your own analysis.
</rlm-preamble>`);

  // 2. Environment — Sandbox API (always present)
  let envBody = `- \`context\` -- task data from your caller. Each agent has its own.
- \`console.log()\` -- observe results between iterations.
- \`return(value)\` -- terminate and return your answer. Only call after verifying via console.log.
- \`require()\` -- Node.js built-in modules only.`;

  if (canDelegate) {
    envBody += `
- \`await rlm(query, context?, options?)\` -- delegate to a child RLM. Options: \`{ systemPrompt?, model?, maxIterations?, app? }\`.
  - \`app\` loads a named program for the child. \`model\` selects an alias (see Available Models). \`maxIterations\` caps the child's budget.
  - **Must be awaited.** Unawaited calls are silently lost.
  - Delegation depth is finite -- check \`__rlm.depth < __rlm.maxDepth\`.`;
  }

  envBody += `
- \`__rlm\` (read-only) -- delegation metadata: \`{ depth, maxDepth, iteration, maxIterations, lineage, invocationId, parentId }\`
- \`__ctx.shared.data\` -- the root context, readable at any depth (frozen).
- Variables persist across iterations. Code from earlier iterations is still in scope.

The sandbox is persistent and shared. All agents in the delegation tree execute in the same JavaScript VM. Variables set before \`rlm()\` are readable by the child. Variables set by the child are readable after it returns. Convention: prefix shared state with \`__\` (double underscore).`;

  if (globalDocs) {
    envBody += `\n\n## Sandbox Globals\n\n${globalDocs}`;
  }

  if (canDelegate && modelTable) {
    envBody += modelTable;
  }

  sections.push(`<rlm-environment>\n${envBody}\n</rlm-environment>`);

  // 3. Context — Position (always present, content varies)
  const rootTask =
    lineage[0].length > 200 ? lineage[0].substring(0, 200) + "..." : lineage[0];
  const roleDesc =
    depth === 0
      ? "You are the root orchestrator."
      : `Parent: "${parentId}". Root task: "${rootTask}"`;
  const delegationDesc = canDelegate
    ? `You can delegate to child RLMs at depth ${depth + 1}.`
    : "You are at maximum delegation depth and cannot spawn child agents.";

  const remainingDepth = maxDepth - depth - 1;
  const depthBudgetDesc =
    remainingDepth > 0
      ? `Remaining delegation depth: ${remainingDepth} level(s) below you.`
      : depth < maxDepth
        ? "Your children will be at maximum depth (leaves, cannot delegate further)."
        : "";

  sections.push(`<rlm-context>
Agent "${invocationId}" -- depth ${depth} of ${maxDepth} (0-indexed).
${roleDesc}
Iteration budget: ${maxIterations} iterations.
${delegationDesc}${depthBudgetDesc ? "\n" + depthBudgetDesc : ""}
</rlm-context>`);

  // 4. Rules — Behavioral Invariants (always present, identical at all depths)
  sections.push(`<rlm-rules>
- One execute_code tool call per response. Stop and wait for output.
- \`return(value)\` only after verifying via \`console.log()\`.
- Always \`await\` rlm() calls -- unawaited calls are silently lost.
- Each iteration must produce observable progress. Write code, observe, adapt.
- Errors are surfaced, not swallowed. Read them and adapt.
- Never return a value you have not first logged and confirmed in output.
</rlm-rules>`);

  // 5. Program — conditional, only when programContent is provided (LAST)
  if (programContent) {
    sections.push(`<rlm-program>\n${programContent}\n</rlm-program>`);
  }

  return sections.join("\n\n");
}

/**
 * Render an "Available Models" system-prompt section from a models registry.
 * Returns empty string if models is undefined/empty.
 */
export function buildModelTable(
  models?: Record<string, { tags?: string[]; description?: string }>,
): string {
  if (!models || Object.keys(models).length === 0) return "";

  const aliases = Object.keys(models).sort();
  const rows = aliases.map((alias) => {
    const { tags, description } = models[alias];
    const tagsStr = tags && tags.length > 0 ? tags.join(", ") : "-";
    const descStr = description || "-";
    return `| ${alias} | ${tagsStr} | ${descStr} |`;
  });

  return (
    `\n\n## Available Models\n\n` +
    `When delegating with \`rlm()\`, you can select a model by alias:\n\n` +
    `| Alias | Tags | Description |\n` +
    `|-------|------|-------------|\n` +
    rows.join("\n") +
    `\n\nUsage: \`await rlm("query", context, { model: "fast" })\`\n` +
    `Default (no model specified): uses the same model as the current agent.`
  );
}
