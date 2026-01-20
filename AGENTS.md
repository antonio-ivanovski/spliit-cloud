<!-- OPENSPEC:START -->

# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:

- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:

- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# Spliit

Open-source expense-splitting app: Next.js + tRPC + Prisma + PostgreSQL.

## Commands

```bash
npm run dev          # Dev server at localhost:3000
npm run build        # Production build
npm check-types      # TypeScript check
npm run lint         # ESLint
npm test             # Jest unit tests
npm run test-e2e     # Playwright E2E tests
```

## Contextual Docs

Open these when the task requires deeper knowledge:

- [Architecture](docs/agent/architecture.md) - Directory structure, data model, tRPC patterns
- [Testing](docs/agent/testing.md) - Unit test and E2E test patterns
- [Features](docs/agent/features.md) - Feature flags, optional capabilities
- [Troubleshooting](docs/agent/troubleshooting.md) - Common issues and solutions
