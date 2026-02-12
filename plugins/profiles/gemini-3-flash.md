---
name: gemini-3-flash
kind: profile
description: Driver profile for Google Gemini 3 Flash
models: ["google/gemini-3-flash*", "google/gemini-3-flash-preview*"]
drivers:
  - no-tool-calls
  - one-block-per-iteration
  - await-discipline
  - return-format-discipline
  - verify-before-return
---

Gemini 3 Flash hallucinates tool calls even with `tools: []`, writes multiple
code blocks per response with fabricated output between them, and sometimes
calls rlm() without await. All five reliability drivers are needed.
