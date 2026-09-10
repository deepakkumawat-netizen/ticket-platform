-- CreateEnum
CREATE TYPE "IntakeChannel" AS ENUM ('WEB_FORM', 'INBOUND_EMAIL');

-- CreateEnum
CREATE TYPE "IntakeQueryStatus" AS ENUM ('PENDING', 'CONVERTED', 'REJECTED');

-- CreateTable
CREATE TABLE "IntakeQuery" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "channel" "IntakeChannel" NOT NULL,
    "status" "IntakeQueryStatus" NOT NULL DEFAULT 'PENDING',
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "companyName" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "suggestedDepartmentId" TEXT,
    "suggestedTicketTypeDefinitionId" TEXT,
    "suggestedPriority" TEXT,
    "classificationReasoning" TEXT,
    "rawPayload" JSONB,
    "convertedTicketId" TEXT,
    "rejectedReason" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeQuery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntakeQuery_convertedTicketId_key" ON "IntakeQuery"("convertedTicketId");

-- CreateIndex
CREATE INDEX "IntakeQuery_orgId_status_idx" ON "IntakeQuery"("orgId", "status");

-- CreateIndex
CREATE INDEX "IntakeQuery_suggestedDepartmentId_status_idx" ON "IntakeQuery"("suggestedDepartmentId", "status");

-- AddForeignKey
ALTER TABLE "IntakeQuery" ADD CONSTRAINT "IntakeQuery_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeQuery" ADD CONSTRAINT "IntakeQuery_suggestedDepartmentId_fkey" FOREIGN KEY ("suggestedDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeQuery" ADD CONSTRAINT "IntakeQuery_convertedTicketId_fkey" FOREIGN KEY ("convertedTicketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

