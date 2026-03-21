# Personal Assistant Agent — Project Docs

A single-user AI assistant that integrates with Google Workspace (Gmail, Calendar, Drive) through a conversational web interface. Built on the Claude Agent SDK with a Hono backend, React frontend, and Postgres for persistence.

## Reading Order

| # | Doc | What it covers |
|---|-----|----------------|
| 1 | [System Overview](design/01_system_overview.md) | Architecture, how pieces connect, data flow |
| 2 | [Agent Spec](design/02_agent_spec.md) | Orchestrator, tools, agent behavior |
| 3 | [Data Layer](design/03_data_layer.md) | Entities, schema, persistence |
| 4 | [Backend](design/04_backend.md) | API routes, middleware, server structure |
| 5 | [Frontend](design/05_frontend.md) | React SPA, components, state management |
| 6 | [Tech Stack](design/06_tech_stack.md) | Frameworks, libraries, services |
| 7 | [Google Connectors](design/07_google_connectors.md) | OAuth, Gmail/Calendar/Drive integration |
| 8 | [Architecture Diagrams](design/08_architecture_diagrams.md) | Visual diagrams |
| 9 | [Deployment](design/09_deployment.md) | Hosting, CI/CD, env config |
| 10 | [Wireframes](design/wireframes.md) | UI wireframes |
| — | [Decisions Log](design/decisions_log.md) | Every architectural decision with rationale |
