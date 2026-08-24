-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "escalationAcknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "escalationAcknowledgedByUserId" TEXT,
ADD COLUMN     "escalationReason" TEXT,
ADD COLUMN     "isEscalated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reassignmentCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TicketTypeVersion" ADD COLUMN     "escalationSnapshot" JSONB;

-- CreateTable
CREATE TABLE "EscalationRule" (
    "id" TEXT NOT NULL,
    "ticketTypeDefinitionId" TEXT NOT NULL,
    "customerType" "CustomerType" NOT NULL,
    "priority" TEXT NOT NULL,
    "escalateOnSlaBreach" BOOLEAN NOT NULL DEFAULT true,
    "reassignmentThreshold" INTEGER,

    CONSTRAINT "EscalationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EscalationRule_ticketTypeDefinitionId_customerType_priority_key" ON "EscalationRule"("ticketTypeDefinitionId", "customerType", "priority");

-- CreateIndex
CREATE INDEX "Ticket_departmentId_isEscalated_idx" ON "Ticket"("departmentId", "isEscalated");

-- AddForeignKey
ALTER TABLE "EscalationRule" ADD CONSTRAINT "EscalationRule_ticketTypeDefinitionId_fkey" FOREIGN KEY ("ticketTypeDefinitionId") REFERENCES "TicketTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

