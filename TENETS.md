# Tenets

What node-rlm believes.

## The RLM is an Intelligent Computer

node-rlm is a self-contained computer whose core is the RLM: a while loop, a model, and a sandbox. The model lives inside the environment. It executes JavaScript, observes results, calls itself recursively, and subdivides work across invocations. This is not a chatbot with tools bolted on. It is a general-purpose computer that runs programs.

## Trust the Model

Push complexity into the model, not the engine. The models are getting better. Every guardrail you hardcode in the runtime is a bet against that trajectory. The engine stays minimal; the model handles ambiguity, error recovery, planning, and judgment. When in doubt, let the model figure it out.

## The Sandbox IS the Tool

There is no tool use. There is no function calling. The model gets a persistent Node.js VM with the full standard library, and that is the only interface it needs. `javascript` code blocks in, output out, loop. Anything Node can do, the RLM can do.

## The Trace is the Record

Every iteration is captured: reasoning, code, output, error. The trace is a structured return value, not a side effect. If you want to know what happened, read the trace. If it is not in the trace, it did not happen. This makes the system inspectable, reproducible, and impossible to lie about.

## Irreducible Core

The engine is a single module. One runtime dependency: `acorn` for JavaScript parsing. No frameworks. No abstractions that do not pay for themselves. The artifact is the product.

## Plugins are Programs Written in Prose

Drivers and apps are markdown files -- strings -- injected into the system prompt. Drivers are composable behavioral shims (stack many). Apps are task architectures (run one). Complex control flow, state management, and composition are all expressed in natural language, and the RLM self-configures into the structures these programs describe. This is what makes the system programmable without making the engine complex.

## Explicit Termination

The loop runs until the model calls `return()`. There is no implicit termination. There is no timeout-as-success. The model must decide it is done and say so. This is a hard contract.

## Fail Loudly

Errors are surfaced, not swallowed. If the model's code fails, the error goes back into the context and the model sees it next iteration. Silent failure is the only unacceptable failure.

## Cost-Aware Delegation

`rlm()` is a recursive loop. A small `maxIterations` (e.g., 1 or 3) makes it cheap and fast. A large budget makes it thorough. The model should calibrate the iteration budget to the subtask: use `rlm("query", ctx, { maxIterations: 1 })` for one-shot classification, and a full budget when the problem demands iterative refinement.

## Testable Through Seams

Testability comes from the API surface, not mocks or dependency injection frameworks. `CallLLM` is a function you pass in. Swap it for a stub. Set `maxIterations` to 1. Inject different plugin bodies. The seams are already there because the design is honest about its boundaries.
