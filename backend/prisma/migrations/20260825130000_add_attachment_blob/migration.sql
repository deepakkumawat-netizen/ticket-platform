-- CreateTable
CREATE TABLE "AttachmentBlob" (
    "id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,

    CONSTRAINT "AttachmentBlob_pkey" PRIMARY KEY ("id")
);
