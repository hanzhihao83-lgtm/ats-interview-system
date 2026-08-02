-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ImportTaskStatus" AS ENUM ('UPLOADED', 'PARSING', 'WAITING_MAPPING', 'VALIDATING', 'WAITING_CONFIRMATION', 'IMPORTING', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('VALID', 'WARNING', 'INVALID');

-- CreateEnum
CREATE TYPE "DuplicateLevel" AS ENUM ('NONE', 'EXACT', 'HIGH_SUSPECT', 'SAME_NAME_DIFFERENT_PERSON', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "HandlingAction" AS ENUM ('CREATE', 'SKIP', 'UPDATE', 'MERGE', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING', 'IMPORTED', 'SKIPPED', 'FAILED', 'MANUAL_REVIEW');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPosition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectName" TEXT,
    "department" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "candidateNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "phone" TEXT,
    "phoneNormalized" TEXT,
    "phoneMasked" TEXT,
    "email" TEXT,
    "emailNormalized" TEXT,
    "emailMasked" TEXT,
    "supplierId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "projectName" TEXT,
    "university" TEXT,
    "normalizedUniversity" TEXT,
    "major" TEXT,
    "highestEducation" TEXT,
    "graduationYear" INTEGER,
    "isFreshGraduate" BOOLEAN,
    "resumeSubmitDate" TIMESTAMP(3),
    "resumeResult" TEXT,
    "currentStatus" TEXT NOT NULL,
    "expectedEntryDate" TIMESTAMP(3),
    "actualEntryDate" TIMESTAMP(3),
    "leaveDate" TIMESTAMP(3),
    "remark" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateStatusEvent" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "operator" TEXT,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "roundName" TEXT,
    "interviewer" TEXT,
    "scheduledStartTime" TIMESTAMP(3) NOT NULL,
    "scheduledEndTime" TIMESTAMP(3),
    "result" TEXT,
    "status" TEXT NOT NULL,
    "meetingProvider" TEXT,
    "meetingId" TEXT,
    "meetingUrl" TEXT,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateImportTask" (
    "id" TEXT NOT NULL,
    "taskNo" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sheetName" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "warningRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportTaskStatus" NOT NULL DEFAULT 'UPLOADED',
    "fieldMapping" JSONB,
    "uploadedBy" TEXT,
    "defaultSupplierId" TEXT,
    "defaultPositionId" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "CandidateImportTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateImportRow" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB NOT NULL,
    "name" TEXT,
    "phoneMasked" TEXT,
    "supplierName" TEXT,
    "positionName" TEXT,
    "university" TEXT,
    "validationStatus" "ValidationStatus" NOT NULL DEFAULT 'INVALID',
    "errors" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "duplicateLevel" "DuplicateLevel" NOT NULL DEFAULT 'NONE',
    "duplicateReasons" JSONB NOT NULL,
    "matchedCandidateIds" JSONB NOT NULL,
    "handlingAction" "HandlingAction" NOT NULL DEFAULT 'CREATE',
    "importStatus" "ImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "importedCandidateId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "candidateId" TEXT,
    "importTaskId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "operator" TEXT,
    "reason" TEXT,
    "operatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportFileRecord" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleanedAt" TIMESTAMP(3),

    CONSTRAINT "ImportFileRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "JobPosition_name_idx" ON "JobPosition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_candidateNo_key" ON "Candidate"("candidateNo");

-- CreateIndex
CREATE INDEX "Candidate_normalizedName_idx" ON "Candidate"("normalizedName");

-- CreateIndex
CREATE INDEX "Candidate_phoneNormalized_idx" ON "Candidate"("phoneNormalized");

-- CreateIndex
CREATE INDEX "Candidate_emailNormalized_idx" ON "Candidate"("emailNormalized");

-- CreateIndex
CREATE INDEX "Candidate_supplierId_idx" ON "Candidate"("supplierId");

-- CreateIndex
CREATE INDEX "Candidate_positionId_idx" ON "Candidate"("positionId");

-- CreateIndex
CREATE INDEX "Candidate_currentStatus_idx" ON "Candidate"("currentStatus");

-- CreateIndex
CREATE INDEX "Candidate_resumeSubmitDate_idx" ON "Candidate"("resumeSubmitDate");

-- CreateIndex
CREATE INDEX "CandidateStatusEvent_candidateId_effectiveAt_idx" ON "CandidateStatusEvent"("candidateId", "effectiveAt");

-- CreateIndex
CREATE INDEX "Interview_candidateId_idx" ON "Interview"("candidateId");

-- CreateIndex
CREATE INDEX "Interview_scheduledStartTime_idx" ON "Interview"("scheduledStartTime");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateImportTask_taskNo_key" ON "CandidateImportTask"("taskNo");

-- CreateIndex
CREATE INDEX "CandidateImportTask_fileHash_idx" ON "CandidateImportTask"("fileHash");

-- CreateIndex
CREATE INDEX "CandidateImportTask_uploadedAt_idx" ON "CandidateImportTask"("uploadedAt");

-- CreateIndex
CREATE INDEX "CandidateImportRow_taskId_validationStatus_idx" ON "CandidateImportRow"("taskId", "validationStatus");

-- CreateIndex
CREATE INDEX "CandidateImportRow_taskId_duplicateLevel_idx" ON "CandidateImportRow"("taskId", "duplicateLevel");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateImportRow_taskId_rowNumber_key" ON "CandidateImportRow"("taskId", "rowNumber");

-- CreateIndex
CREATE INDEX "OperationLog_candidateId_idx" ON "OperationLog"("candidateId");

-- CreateIndex
CREATE INDEX "OperationLog_importTaskId_idx" ON "OperationLog"("importTaskId");

-- CreateIndex
CREATE INDEX "OperationLog_operatedAt_idx" ON "OperationLog"("operatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportFileRecord_taskId_key" ON "ImportFileRecord"("taskId");

-- CreateIndex
CREATE INDEX "ImportFileRecord_fileHash_idx" ON "ImportFileRecord"("fileHash");

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "JobPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateStatusEvent" ADD CONSTRAINT "CandidateStatusEvent_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateImportRow" ADD CONSTRAINT "CandidateImportRow_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CandidateImportTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateImportRow" ADD CONSTRAINT "CandidateImportRow_importedCandidateId_fkey" FOREIGN KEY ("importedCandidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLog" ADD CONSTRAINT "OperationLog_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLog" ADD CONSTRAINT "OperationLog_importTaskId_fkey" FOREIGN KEY ("importTaskId") REFERENCES "CandidateImportTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportFileRecord" ADD CONSTRAINT "ImportFileRecord_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CandidateImportTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
