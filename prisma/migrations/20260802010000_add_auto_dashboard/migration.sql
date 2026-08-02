CREATE TABLE "ImportedDataset" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "storedFileName" TEXT NOT NULL,
  "fileHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "statusMessage" TEXT,
  "totalSheets" INTEGER NOT NULL DEFAULT 0,
  "processedSheets" INTEGER NOT NULL DEFAULT 0,
  "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "supplierCount" INTEGER NOT NULL DEFAULT 0,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "dashboardId" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportedDataset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportedCandidate" (
  "id" TEXT NOT NULL,
  "datasetId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "supplier" TEXT,
  "businessType" TEXT,
  "resumeFile" TEXT,
  "interviewTimeRaw" TEXT,
  "interviewStartTime" TIMESTAMP(3),
  "interviewEndTime" TIMESTAMP(3),
  "meetingCode" TEXT,
  "meetingUrl" TEXT,
  "meetingTextRaw" TEXT,
  "interviewResult" TEXT,
  "level" TEXT,
  "interviewer" TEXT,
  "interviewComment" TEXT,
  "entryDate" TIMESTAMP(3),
  "entryStatus" TEXT,
  "sourceSheet" TEXT NOT NULL,
  "sourceRow" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportedCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportedSupplierSummary" (
  "id" TEXT NOT NULL,
  "datasetId" TEXT NOT NULL,
  "supplier" TEXT NOT NULL,
  "videoResumeCount" INTEGER,
  "audioResumeCount" INTEGER,
  "videoInterviewPassed" INTEGER,
  "videoConfirmedEntry" INTEGER,
  "videoActualEntry" INTEGER,
  "audioInterviewPassed" INTEGER,
  "audioConfirmedEntry" INTEGER,
  "audioActualEntry" INTEGER,
  "status" TEXT,
  "remark" TEXT,
  "sourceSheet" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportedSupplierSummary_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GeneratedDashboard" (
  "id" TEXT NOT NULL,
  "datasetId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GeneratedDashboard_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportedDataset_fileHash_idx" ON "ImportedDataset"("fileHash");
CREATE INDEX "ImportedDataset_createdAt_idx" ON "ImportedDataset"("createdAt");
CREATE INDEX "ImportedCandidate_datasetId_idx" ON "ImportedCandidate"("datasetId");
CREATE INDEX "ImportedCandidate_supplier_idx" ON "ImportedCandidate"("supplier");
CREATE INDEX "ImportedCandidate_businessType_idx" ON "ImportedCandidate"("businessType");
CREATE INDEX "ImportedCandidate_interviewResult_idx" ON "ImportedCandidate"("interviewResult");
CREATE INDEX "ImportedCandidate_entryStatus_idx" ON "ImportedCandidate"("entryStatus");
CREATE INDEX "ImportedCandidate_interviewStartTime_idx" ON "ImportedCandidate"("interviewStartTime");
CREATE INDEX "ImportedSupplierSummary_datasetId_idx" ON "ImportedSupplierSummary"("datasetId");
CREATE INDEX "ImportedSupplierSummary_supplier_idx" ON "ImportedSupplierSummary"("supplier");
CREATE UNIQUE INDEX "GeneratedDashboard_datasetId_key" ON "GeneratedDashboard"("datasetId");
ALTER TABLE "ImportedCandidate" ADD CONSTRAINT "ImportedCandidate_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ImportedDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportedSupplierSummary" ADD CONSTRAINT "ImportedSupplierSummary_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ImportedDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeneratedDashboard" ADD CONSTRAINT "GeneratedDashboard_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ImportedDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
