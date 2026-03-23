-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('CONTACT', 'COMPANY', 'DEAL');

-- CreateEnum
CREATE TYPE "SystemSource" AS ENUM ('HUBSPOT', 'SAP');

-- CreateEnum
CREATE TYPE "SyncOperation" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'IN_FLIGHT', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "id_map" (
    "id" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "hubspotId" TEXT NOT NULL,
    "sapId" TEXT NOT NULL,
    "syncInProgress" BOOLEAN NOT NULL DEFAULT false,
    "syncInitiatedBy" "SystemSource",
    "syncStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "id_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_log" (
    "id" TEXT NOT NULL,
    "idMapId" TEXT,
    "entityType" "EntityType" NOT NULL,
    "operation" "SyncOperation" NOT NULL,
    "sourceSystem" "SystemSource" NOT NULL,
    "targetSystem" "SystemSource" NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "inboundPayload" JSONB NOT NULL,
    "outboundPayload" JSONB,
    "errorMessage" TEXT,
    "errorCode" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retry_job" (
    "id" TEXT NOT NULL,
    "bullmqJobId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "exhausted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retry_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "id_map_hubspotId_key" ON "id_map"("hubspotId");

-- CreateIndex
CREATE UNIQUE INDEX "id_map_sapId_key" ON "id_map"("sapId");

-- CreateIndex
CREATE UNIQUE INDEX "id_map_entityType_hubspotId_key" ON "id_map"("entityType", "hubspotId");

-- CreateIndex
CREATE UNIQUE INDEX "id_map_entityType_sapId_key" ON "id_map"("entityType", "sapId");

-- CreateIndex
CREATE UNIQUE INDEX "retry_job_bullmqJobId_key" ON "retry_job"("bullmqJobId");

-- AddForeignKey
ALTER TABLE "sync_log" ADD CONSTRAINT "sync_log_idMapId_fkey" FOREIGN KEY ("idMapId") REFERENCES "id_map"("id") ON DELETE SET NULL ON UPDATE CASCADE;
