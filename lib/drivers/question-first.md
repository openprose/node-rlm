---
name: question-first
kind: driver
version: 0.1.0
description: Read the question before exploring data — classify the problem type, then match approach
author: sl
tags: [strategy, planning, problem-classification]
requires: []
---

## Question First

Before touching the data, understand the question.

### Step 1: Parse the question (iteration 1, before any data exploration)

Log your answers to these three questions:

```javascript
console.log("QUESTION TYPE:", "...");   // comparison, count, label, search, etc.
console.log("ANSWER FORMAT:", "...");   // "more/less common than", a number, a label name, etc.
console.log("REQUIRED FIELDS:", "..."); // what data fields do I need to answer this?
```

Example: "Compare the frequency of 'entity' vs 'location' labels" →
- QUESTION TYPE: comparison
- ANSWER FORMAT: "more common than" or "less common than"
- REQUIRED FIELDS: a label for each item, then counts per label

### Step 2: Explore data (iterations 1-2)

Now look at the data. Log type, length, structure, a sample. Then answer:

```javascript
console.log("DATA HAS:", "...");        // what fields/structure does the data actually contain?
console.log("GAP:", "...");             // what's missing between what I have and what I need?
```

### Step 3: Bridge the gap (iteration 3+)

The GAP determines your approach. See the gap-approach table in `exploration-budget` for the full mapping. The short version: no gap means compute directly; missing labels means classify via `rlm()` fanout; too-large data means chunk and delegate.

**The most common gap:** the question asks about labels that don't exist in the data. This means you need to CREATE the labels by classifying items. Use `rlm()` with batched parallel calls to classify, then count the results in code. Do not search the data for labels that aren't there.
