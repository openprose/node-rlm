---
name: json-stringify-return
kind: driver
version: 0.1.0
description: Return JSON.stringify(value) for structured data — prevents serialization bugs
author: sl
tags: [format, reliability, arc]
requires: []
---

## Stringify Structured Returns

When returning structured data (arrays, grids, objects):

**Always** call `return(JSON.stringify(value))`, never `return(value)`.

Returning a raw array or object can cause silent serialization bugs where the harness receives `[object Object]` or a truncated string instead of the actual data. `JSON.stringify` guarantees a clean round-trip.
