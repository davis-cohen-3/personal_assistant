# Architecture Review: Layer Design Decisions

## Status: Resolved

This document records the architectural review and decisions made about layer responsibilities.

---

## Decision: Rename `core/` to `services/`

### Problem

The original design called the business logic layer `core/` and claimed it was "pure" — no external API calls. But several core functions directly called connectors (Gmail, Calendar, Drive):

- `core/threads.fetchNewThreads` called `emailClient.searchThreads`
- `core/events.syncFromCalendar` called `calendarClient.listEvents`
- `core/actions.approve` dispatched to connectors via an internal switch

This created a contradiction: core was supposed to be pure, but it wasn't.

### Resolution

**Rename `core/` to `services/` and make it honest about what it does.** Services own the full lifecycle of each domain: validation, state machines, transactions, DB persistence, AND connector calls. This is the right framing because:

1. **One place for each operation.** Routes, agent tools, and the heartbeat all call services. Nobody else orchestrates connector + DB calls.
2. **No duplication.** If tools had to compose connector + service calls, the same composition would be needed in routes and heartbeat too.
3. **Services IS what this layer is.** It's a service layer. Calling it "core" and pretending it's pure just creates confusion.

### What changed

- `core/` → `services/` everywhere
- Services explicitly import and call connectors
- Agent tools become thin wrappers over services (define schema, call service method)
- Import rules updated: only `services/` imports `connectors/`

---

## Decision: Tools Are Thin Wrappers Over Services

### Problem

The original (mid-review) design had tools doing the connector→core composition — tools called connectors for reads and core for writes. This meant tools had real logic, and routes/heartbeat would need to duplicate that composition.

### Resolution

**Tools are thin wrappers.** They define the agent-facing schema (name, description, input_schema) and call the corresponding service method. One-liners. All logic lives in services.

```
Agent → Tool (schema + handler) → Service (logic + connector + DB)
Route → Service (same method)
Heartbeat → Service (same method)
```

### Why this is better

- Services are the single source of truth
- Tools are trivially testable (did it call the right service?)
- No duplication between tools, routes, and heartbeat

---

## Decision: Agent Layer Design

### Problem

The original design docs had no specification for the agent layer — no tool definitions, no orchestrator design, no conversation management, no streaming protocol.

### Resolution

Created `agents_layer.md` specifying:

- **`agents/client.ts`** — SDK client init
- **`agents/orchestrator.ts`** — Conversation management, tool dispatch, streaming via WebSocket
- **`agents/tools/`** — Thin wrappers over services, registered with the orchestrator
- **`agents/skills/`** — Pre-composed workflows with focused prompts and tool subsets

See [agents_layer.md](agents_layer.md) for full details.

---

## Updated Layer Diagram

```
routes/     →  services/  →  db/
                           →  connectors/

agents/
  orchestrator  →  tools/  →  services/  →  db/
                                          →  connectors/

heartbeat   →  services/  →  db/
                           →  connectors/
             →  skills/   →  tools/  →  services/
```

Services are the single integration point. Everyone goes through services.
