---
name: synthesize
description: Convert brainstorm chunks into structured requirements.md. Run after /brainstorm completes.
disable-model-invocation: true
---

# Synthesize

Convert brainstorm output into a structured requirements document.

When starting, announce: "📝 Synthesizing brainstorm into requirements"

## Prerequisites

- `specs/{issue}/brainstorm/synthesis.md` must exist
- `specs/{issue}/brainstorm/chunks/` must have files

If missing: **STOP** — "Run `/brainstorm` first."

## Process

1. Read `brainstorm/synthesis.md` and all chunks in `brainstorm/chunks/`
2. Categorize chunks by type:
   - QUESTION + CONSTRAINT → Problem Statement
   - IDEA → User Stories
   - DECISION → Acceptance Criteria
   - CONSTRAINT → Constraints section
   - Unresolved QUESTION → Open Questions
   - RESEARCH/INSIGHT inform all sections
3. Write `requirements.md` with Status: Draft
4. Present to user, highlight thin sections, call out open questions
5. **Do NOT auto-advance**

Suggest: "Run `/review-spec requirements` to walk through and approve."
