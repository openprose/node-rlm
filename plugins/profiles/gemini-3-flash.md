---
name: gemini-3-flash
kind: profile
description: Driver profile for Google Gemini 3 Flash
models: ["google/gemini-3-flash*", "google/gemini-3-flash-preview*"]
drivers:
  - await-discipline
  - return-format-discipline
  - verify-before-return
---

Gemini 3 Flash sometimes calls rlm() without await. Reliability drivers
help enforce discipline.
