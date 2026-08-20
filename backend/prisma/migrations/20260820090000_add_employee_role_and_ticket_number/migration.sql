-- Add EMPLOYEE to the StaffRole enum (self-service accounts — see
-- packages/shared/src/enums.ts for what this role can and can't do).
-- IF NOT EXISTS makes this safe to re-run if a later statement in this file
-- ever needs fixing and reapplying.
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'EMPLOYEE';

-- Human-facing sequential ticket number (rendered as "{deptKey}-{n}", e.g.
-- "TECH-42"). A single org-wide sequence, not one per department — Postgres
-- guarantees no two tickets ever collide without any application-level
-- locking, which a true per-department counter would require.
--
-- nextval()'s argument is a plain string, not a quoted identifier — without
-- the inner double quotes here, Postgres folds it to lowercase
-- (ticket_ticketnumber_seq) and can't find the mixed-case sequence name
-- CREATE SEQUENCE just created.
CREATE SEQUENCE "Ticket_ticketNumber_seq";
ALTER TABLE "Ticket" ADD COLUMN "ticketNumber" INTEGER NOT NULL DEFAULT nextval('"Ticket_ticketNumber_seq"');
ALTER SEQUENCE "Ticket_ticketNumber_seq" OWNED BY "Ticket"."ticketNumber";
CREATE UNIQUE INDEX "Ticket_ticketNumber_key" ON "Ticket"("ticketNumber");
