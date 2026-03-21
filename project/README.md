# Personal Assistant Agent — Project Docs

A conversational AI agent that acts as an executive assistant for GSuite. Single-user per deployment.

## Reading Order

### Requirements (what the system does)
1. [Product Overview](requirements/product_overview.md) — high-level vision, layers, delivery surface
2. [Data Model](requirements/data_model.md) — product flows, entity definitions, design decisions
3. [System Spec](requirements/system_spec.md) — **the source of truth** — entities, operations, skills, architecture, flows, preferences

### Design (how it's built)
4. [Tech Stack](design/tech_stack.md) — frameworks, libraries, services
5. [Backend Architecture](design/backend_architecture.md) — layers, data flow, middleware, db access patterns, error handling, infra
6. [Database Schema](design/database_schema.md) — exact DDL, migrations, indexes
7. [Business Logic](design/business_logic.md) — core/ module specs, state machines, validation rules, cross-module calls
8. [API Design](design/api_design.md) — endpoints, request/response contracts
9. [Agent Architecture](design/agent_architecture.md) — orchestrator, subagent spawning, context passing
10. [Agent Prompts](design/agent_prompts.md) — system prompts for orchestrator + each subagent
11. [Google Integration](design/google_integration.md) — OAuth flow, API scopes, token management
12. [UI Spec](design/ui_spec.md) — screens, components, layout, interaction patterns
13. [Deployment](design/deployment.md) — hosting, CI/CD, env config

### Tasks (execution plan)
- [Decisions Log](tasks/decisions_log.md) — every decision made with rationale
- [Build Plan](tasks/build_plan.md) — phased build plan with per-phase specs

### Build Phases
Each phase gets its own spec in `tasks/phases/`:
- `tasks/phases/phase_1_*.md`
- `tasks/phases/phase_2_*.md`
- etc.

## Status

| Doc | Status |
|---|---|
| Product Overview | Done |
| Data Model | Done |
| System Spec | Done |
| Tech Stack | Done |
| Backend Architecture | Done |
| Database Schema | Done |
| Business Logic | Done |
| API Design | Done |
| Agent Architecture | Not started |
| Agent Prompts | Not started |
| Google Integration | Not started |
| UI Spec | Not started |
| Deployment | Not started |
| Decisions Log | In progress |
| Build Plan | Not started |
