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

`render.yaml` at the repo root is a Render Blueprint — ONE combined web service (the backend
builds the frontend and serves its static files itself — see `ServeStaticModule` in
`backend/src/app.module.ts` — so there's no second service or cross-origin URL to keep in sync)
plus a free Redis-compatible Key Value store. Native Node runtime, no Dockerfile involved.

Render's own Postgres has no free tier for new databases, so the database is external:

1. Create a free project at [neon.tech](https://neon.tech) and copy its connection string
   (`postgresql://...`).
2. Push this repo to GitHub (already done if you're reading this from the deployed repo).
3. In the Render dashboard: **New +** → **Blueprint** → select this repo. Render reads
   `render.yaml` and shows you the 2 services it's about to create.
4. When prompted for `DATABASE_URL`, paste the Neon connection string.
5. Deploy. The build step compiles both backend and frontend.
6. Run migrations + seed once, from your machine, pointed at the Neon database (see below for
   why this can't run as part of the Render deploy itself):
   ```bash
   DATABASE_URL="<neon connection string>" npx prisma migrate deploy --schema=backend/prisma/schema.prisma
   DATABASE_URL="<neon connection string>" npm run prisma:seed --workspace backend
   ```
   (On Windows PowerShell: `$env:DATABASE_URL="<neon connection string>"; <command>`)

**Why migrations run manually, and why the app uses Neon's serverless driver:** confirmed live
across two attempts — Prisma's default Rust query engine failed every connection with
`P1001: Can't reach database server` (it resolves/connects to the DB itself, bypassing Node
entirely, and Render's network can't route IPv6 to Neon's endpoint). Switching to a plain `pg`
driver adapter (raw TCP on port 5432) got further but still hit intermittent
`getaddrinfo ENOTFOUND` failures — Render's outbound DNS/TCP path to Neon's direct endpoint isn't
fully reliable. The fix that actually holds up: **Neon's own serverless driver**
(`@neondatabase/serverless` + `@prisma/adapter-neon`, wired up in `backend/src/prisma/prisma.service.ts`),
which talks to Neon over a WebSocket tunneled through standard HTTPS (port 443) instead of raw
TCP — this is Neon's own recommended approach for serverless/edge-style hosts and sidesteps the
whole class of raw-socket connectivity issues. `prisma migrate deploy` still isn't covered by
this (it's a separate CLI component with its own connection logic), so it runs manually from a
machine that can reach Neon directly instead.

Prefer to set this up by hand instead of via Blueprint? Same commands, just entered directly in
Render's "New Web Service" form:
- **Build Command**: `npm install && npm run build --workspace packages/shared && npx prisma generate --schema=backend/prisma/schema.prisma && npm run build --workspace backend && npm run build --workspace frontend`
- **Start Command**: `node backend/dist/src/main.js`
- **Environment Variables**: `DATABASE_URL` (Neon connection string), `JWT_ACCESS_SECRET` (any long random string), `JWT_ACCESS_TTL=15m`

## Repo layout

```
packages/shared/   field-definition schema + enums shared by backend & frontend
backend/           NestJS API, Prisma schema/migrations
frontend/          React + Vite + TS app
infra/             (reserved for prod compose overrides, etc.)
docker-compose.yml Postgres + Redis for local dev
```
