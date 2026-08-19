# Ticket Platform

Internal low-code ticket management system. Departments (Tech → Operations → Content → Sales)
onboard onto one generic engine by *configuring* ticket types/fields/statuses/SLAs through an
admin UI — not by writing new backend code per department. Serves two audiences: internal staff
(Super Admin / Dept Admin / Agent) and external B2B/B2C customers via a separate portal login.

Full architecture, data model, and phased roadmap: see the plan this was built from
(`stop-working-on-this-typed-rainbow.md`) — summarized here for quick reference.

## Stack

- **Backend**: NestJS + Prisma + PostgreSQL, Redis/BullMQ for background jobs (SLA breach checks, notifications)
- **Frontend**: React + Vite + TypeScript, one SPA with two route trees (`/app/*` staff, `/portal/*` customer)
- **Shared**: `packages/shared` — enums + Zod schemas for the low-code field-definition engine, imported by both backend and frontend so form validation never drifts between them

## Status

**Phase 0 (platform foundation) — in progress.** Built so far:
- Repo/workspace scaffold, Docker Compose (Postgres + Redis), Prisma schema for the full data model
- Auth: separate staff vs customer login (`/auth/staff/login`, `/auth/portal/login`), JWT with a
  hard `principalType` boundary enforced by two independent Passport strategies + guards, RBAC
  (`@Roles`) and department/company/customer scoping helpers (`src/common/scope.ts`)
- Minimal frontend shell: staff login, customer portal login, guarded route trees

**Not yet built** (see the plan's Phase 0 checklist): the low-code ticket-type/field/status/SLA
admin UI and publish/versioning flow, ticket CRUD + comments/attachments, the SLA due-date +
breach-check job, dashboards, notifications, audit log writes.

## Local setup

```bash
# 1. Start Postgres + Redis
docker compose up -d

# 2. Install all workspace dependencies
npm install

# 3. Configure the backend
cp backend/.env.example backend/.env
# edit backend/.env if you changed docker-compose's default DB credentials

# 4. Build the shared package (backend/frontend both import its compiled output)
npm run build --workspace packages/shared

# 5. Create the database schema and seed a dev fixture
#    (1 org, all 4 departments seeded inactive, 1 SUPER_ADMIN login)
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run prisma:seed

# 6. Run backend + frontend (separate terminals)
npm run dev:backend    # http://localhost:3000
npm run dev:frontend   # http://localhost:5173
```

Seeded login (created by `prisma:seed`, change before real use):
`admin@codevidhya.com` / `ChangeMe123!`

## Deploying to Render (no Docker)

`render.yaml` at the repo root is a Render Blueprint — it provisions the backend (native Node
runtime, no Dockerfile involved), the static-built frontend, and a free Redis-compatible Key Value
store, all in one go.

Render's own Postgres has no free tier for new databases, so the database is external:

1. Create a free project at [neon.tech](https://neon.tech) and copy its connection string
   (`postgresql://...`).
2. Push this repo to GitHub (already done if you're reading this from the deployed repo).
3. In the Render dashboard: **New +** → **Blueprint** → select this repo. Render reads
   `render.yaml` and shows you the 3 services it's about to create.
4. When prompted for `DATABASE_URL` on the backend service, paste the Neon connection string.
5. Deploy. The backend's build step runs `prisma migrate deploy` against that database
   automatically on every deploy — no separate migration step needed.
6. Once deployed, check the backend service's actual URL in the Render dashboard (it may differ
   from `https://ticketplatform-backend.onrender.com` if that name was already taken) — if it
   differs, update `VITE_API_BASE_URL` in `render.yaml` (or directly in the frontend service's
   environment settings) and redeploy the frontend.
7. Run the seed script once, from your machine, pointed at the Neon database:
   ```bash
   DATABASE_URL="<neon connection string>" npm run prisma:seed --workspace backend
   ```
   (On Windows PowerShell: `$env:DATABASE_URL="<neon connection string>"; npm run prisma:seed --workspace backend`)

## Repo layout

```
packages/shared/   field-definition schema + enums shared by backend & frontend
backend/           NestJS API, Prisma schema/migrations
frontend/          React + Vite + TS app
infra/             (reserved for prod compose overrides, etc.)
docker-compose.yml Postgres + Redis for local dev
```
