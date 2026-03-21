---
name: review-spec
description: Interactive walkthrough of a spec document (requirements.md, design.md, or tasks.md) for user approval. Usage: /review-spec {requirements|design|tasks}
disable-model-invocation: true
---

# Review Spec

STARTER_CHARACTER = 🔍

Interactive walkthrough of a spec document for user approval.

**Usage:** `/review-spec {requirements|design|tasks}`

When starting, announce: "🔍 Reviewing {doc type}"

## Dependency Check

1. Determine which document to review from the argument:
   - `requirements` → `requirements.md`
   - `design` → `design.md`
   - `tasks` → `tasks.md`
2. If no argument: **STOP** — "Specify which doc: `/review-spec requirements`, `/review-spec design`, or `/review-spec tasks`"
3. If the file doesn't exist in the spec folder: **STOP** — "{doc}.md not found."

## Process

### Step 1: Read the Document

Read the target document. Identify all sections.

### Step 2: Walk Through Each Section

Present each section one at a time:
1. Show the section content
2. Ask a focused question (e.g., "Does this capture the problem?" / "Any concerns?" / "Anything missing?")
3. Wait for user response before continuing

### Step 3: Record Adjustments

For each change the user requests:
1. Update the document inline
2. If `brainstorm/chunks/` exists, save a DECISION chunk recording the change and rationale

### Step 4: Final Confirmation

- Summarize all changes made
- Ask: "{Doc type} complete — ready to approve?"
- **Gate:** User must explicitly confirm

### Step 5: Mark as Approved

- Update `Status` field from "Draft" to "Approved"
- Announce: "🔍 {Doc type} approved."
- Suggest next step:
  - After requirements: "Run `/spec-driven-dev` to create design and tasks."
  - After design: "Run `/spec-driven-dev` to create tasks, or start implementation."
  - After tasks: "Ready for implementation."
