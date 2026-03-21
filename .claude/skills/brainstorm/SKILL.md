---
name: brainstorm
description: Conversational brainstorming facilitator. Use when starting a new feature or problem exploration. Guides through discussion, exploration, and evaluation subphases.
disable-model-invocation: true
---

# Brainstorm

STARTER_CHARACTER = 🧠

When starting, announce: "🧠 Using BRAINSTORM skill — Subphase 1: Discussion"

## Dependency Check

Before anything else, verify the spec folder exists:
- Look for `specs/{issue}/` where `{issue}` matches the current work context
- If no spec folder found: **STOP** and tell the user: "No spec folder found. Run `/new-issue {name}` first."

## Setup

1. Create `brainstorm/` and `brainstorm/chunks/` inside the spec folder if they don't exist
2. Copy `specs/_templates/brainstorm/checklist.md` to `specs/{issue}/brainstorm/checklist.md`

## Subphase 1 — Discussion

**Goal:** Understand the problem space through conversation.

**Rules:**
- NO code exploration tools (no Read, Grep, Glob, WebSearch)
- Pure conversation — ask questions, explore ideas, challenge assumptions
- Play devil's advocate, suggest alternatives, probe edge cases

**After each significant exchange, save a chunk:**
- **IDEA**: potential approaches or solutions
- **QUESTION**: open questions needing answers
- **CONSTRAINT**: limitations or boundaries identified

**Chunk saving process:**
1. Scan `brainstorm/chunks/` for highest existing ID (files named `NNN_type_slug.md`)
2. Increment to get next ID (or start at 001)
3. Write file as `{ID}_{type}_{slug}.md` using the chunk template format
4. Fill in: ID, today's date, type, status as "active", content, and context

**Phase transition:**
- Suggest moving to exploration when the problem space feels well understood
- Say something like: "I think we have a good grasp of the problem space. Ready to explore the codebase?"
- User explicitly triggers transition with "let's explore" or similar

## Subphase 2 — Exploration

When starting: "🧠 Subphase 2: Exploration"

**Goal:** Investigate the codebase to validate and refine ideas.

**Rules:**
- Full tool access (Read, Grep, Glob, Bash, WebSearch)
- Save chunks for findings:
  - **RESEARCH**: findings from code/doc exploration
  - **INSIGHT**: patterns, implications, or connections discovered

**What to explore:**
- Existing code that relates to the feature
- Similar patterns already in the codebase
- Dependencies and potential conflicts
- Technical constraints from the architecture

**Phase transition:**
- When exploration feels complete: "I think we've explored enough. Ready for evaluation?"

## Subphase 3 — Evaluation

When starting: "🧠 Subphase 3: Evaluation"

**Goal:** Assess completeness and synthesize findings.

**Walk through checklist:**
- [ ] Problem clearly defined?
- [ ] User impact understood?
- [ ] Technical constraints identified?
- [ ] Key decisions made?
- [ ] Open questions listed?
- [ ] Architecture impact assessed?

**Generate synthesis:** Write `specs/{issue}/brainstorm/synthesis.md` summarizing all chunks.

**Suggest next step:** "Run `/synthesize` to convert into requirements."
