ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DEPARTMENT_MANAGER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'VIDEO_RECRUITER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'AUDIO_RECRUITER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPPLIER_VIDEO_RECRUITER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPPLIER_AUDIO_RECRUITER';

CREATE TYPE "BusinessLine" AS ENUM ('VIDEO', 'AUDIO', 'UNCLASSIFIED');

ALTER TABLE "CandidateImportTask" ADD COLUMN "businessLine" "BusinessLine";
ALTER TABLE "ImportedDataset" ADD COLUMN "businessLine" "BusinessLine";
ALTER TABLE "GeneratedDashboard" ADD COLUMN "businessLine" "BusinessLine";
ALTER TABLE "OperationLog" ADD COLUMN "applicationId" TEXT,
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "businessLine" "BusinessLine";

CREATE TABLE "CandidateApplication" (
  "id" TEXT NOT NULL,
  "applicationNo" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "businessLine" "BusinessLine" NOT NULL,
  "positionId" TEXT,
  "projectName" TEXT,
  "currentStatus" TEXT NOT NULL,
  "resumeResult" TEXT,
  "interviewResult" TEXT,
  "expectedEntryDate" TIMESTAMP(3),
  "actualEntryDate" TIMESTAMP(3),
  "businessData" JSONB,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "CandidateApplication_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CandidateApplication_applicationNo_key" ON "CandidateApplication"("applicationNo");
CREATE INDEX "CandidateApplication_candidateId_idx" ON "CandidateApplication"("candidateId");
CREATE INDEX "CandidateApplication_supplierId_idx" ON "CandidateApplication"("supplierId");
CREATE INDEX "CandidateApplication_businessLine_idx" ON "CandidateApplication"("businessLine");
CREATE INDEX "CandidateApplication_supplierId_businessLine_idx" ON "CandidateApplication"("supplierId", "businessLine");
CREATE INDEX "CandidateApplication_businessLine_currentStatus_idx" ON "CandidateApplication"("businessLine", "currentStatus");
CREATE INDEX "CandidateApplication_supplierId_businessLine_currentStatus_idx" ON "CandidateApplication"("supplierId", "businessLine", "currentStatus");
ALTER TABLE "CandidateApplication" ADD CONSTRAINT "CandidateApplication_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CandidateApplication" ADD CONSTRAINT "CandidateApplication_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CandidateApplication" ADD CONSTRAINT "CandidateApplication_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "JobPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "CandidateApplication" (
  "id", "applicationNo", "candidateId", "supplierId", "businessLine", "positionId", "projectName",
  "currentStatus", "resumeResult", "expectedEntryDate", "actualEntryDate", "businessData", "createdAt", "updatedAt", "deletedAt"
)
SELECT
  'legacy-app-' || c."id", 'LEGACY-' || c."candidateNo", c."id", c."supplierId",
  CASE
    WHEN concat_ws(' ', p."name", p."department", c."projectName") ~* '(音频|ASR|语音|转写)' THEN 'AUDIO'::"BusinessLine"
    WHEN concat_ws(' ', p."name", p."department", c."projectName") ~* '(视频|Caption|GSB|SBS)' THEN 'VIDEO'::"BusinessLine"
    ELSE 'UNCLASSIFIED'::"BusinessLine"
  END,
  c."positionId", c."projectName", c."currentStatus", c."resumeResult", c."expectedEntryDate", c."actualEntryDate",
  CASE WHEN concat_ws(' ', p."name", p."department", c."projectName") !~* '(音频|ASR|语音|转写|视频|Caption|GSB|SBS)'
    THEN jsonb_build_object('classificationStatus', '待归类', 'migrationSource', 'Candidate') ELSE NULL END,
  c."createdAt", c."updatedAt", c."deletedAt"
FROM "Candidate" c
JOIN "JobPosition" p ON p."id" = c."positionId";

ALTER TABLE "Interview" ADD COLUMN "applicationId" TEXT,
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "businessLine" "BusinessLine";
UPDATE "Interview" i SET
  "applicationId" = a."id",
  "supplierId" = a."supplierId",
  "businessLine" = a."businessLine"
FROM "CandidateApplication" a
WHERE a."candidateId" = i."candidateId" AND a."applicationNo" LIKE 'LEGACY-%';
CREATE INDEX "Interview_applicationId_idx" ON "Interview"("applicationId");
CREATE INDEX "Interview_supplierId_businessLine_idx" ON "Interview"("supplierId", "businessLine");
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CandidateApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AIResumeScreeningResult" (
  "id" TEXT NOT NULL, "candidateId" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "businessLine" "BusinessLine" NOT NULL,
  "jobId" TEXT, "score" INTEGER NOT NULL, "matchedPoints" JSONB NOT NULL, "missingPoints" JSONB NOT NULL,
  "riskPoints" JSONB NOT NULL, "interviewQuestions" JSONB NOT NULL, "recommendedLevel" TEXT, "confidence" DOUBLE PRECISION,
  "promptVersion" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AIResumeScreeningResult_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AIResumeScreeningResult_applicationId_idx" ON "AIResumeScreeningResult"("applicationId");
CREATE INDEX "AIResumeScreeningResult_businessLine_idx" ON "AIResumeScreeningResult"("businessLine");
ALTER TABLE "AIResumeScreeningResult" ADD CONSTRAINT "AIResumeScreeningResult_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AIResumeScreeningResult" ADD CONSTRAINT "AIResumeScreeningResult_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CandidateApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "KimNotificationLog" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "interviewId" TEXT, "supplierId" TEXT NOT NULL,
  "businessLine" "BusinessLine" NOT NULL, "status" TEXT NOT NULL, "messageSummary" TEXT, "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "KimNotificationLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "KimNotificationLog_applicationId_idx" ON "KimNotificationLog"("applicationId");
CREATE INDEX "KimNotificationLog_supplierId_businessLine_idx" ON "KimNotificationLog"("supplierId", "businessLine");
CREATE INDEX "KimNotificationLog_interviewId_idx" ON "KimNotificationLog"("interviewId");
ALTER TABLE "KimNotificationLog" ADD CONSTRAINT "KimNotificationLog_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CandidateApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KimNotificationLog" ADD CONSTRAINT "KimNotificationLog_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TencentMeetingRecord" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "interviewId" TEXT, "supplierId" TEXT NOT NULL,
  "businessLine" "BusinessLine" NOT NULL, "meetingCode" TEXT, "meetingUrl" TEXT, "providerId" TEXT,
  "status" TEXT NOT NULL, "interviewer" TEXT, "scheduledAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "TencentMeetingRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TencentMeetingRecord_applicationId_idx" ON "TencentMeetingRecord"("applicationId");
CREATE INDEX "TencentMeetingRecord_supplierId_businessLine_idx" ON "TencentMeetingRecord"("supplierId", "businessLine");
CREATE INDEX "TencentMeetingRecord_interviewId_idx" ON "TencentMeetingRecord"("interviewId");
CREATE INDEX "TencentMeetingRecord_scheduledAt_idx" ON "TencentMeetingRecord"("scheduledAt");
ALTER TABLE "TencentMeetingRecord" ADD CONSTRAINT "TencentMeetingRecord_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CandidateApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TencentMeetingRecord" ADD CONSTRAINT "TencentMeetingRecord_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL, "userId" TEXT, "action" TEXT NOT NULL, "resourceType" TEXT NOT NULL, "resourceId" TEXT,
  "requestedScope" JSONB, "effectiveScope" JSONB, "result" TEXT NOT NULL, "reason" TEXT, "requestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");
CREATE INDEX "AuditLog_result_createdAt_idx" ON "AuditLog"("result", "createdAt");

CREATE INDEX "CandidateImportTask_businessLine_idx" ON "CandidateImportTask"("businessLine");
CREATE INDEX "ImportedDataset_businessLine_idx" ON "ImportedDataset"("businessLine");
CREATE INDEX "GeneratedDashboard_businessLine_idx" ON "GeneratedDashboard"("businessLine");
CREATE INDEX "OperationLog_applicationId_idx" ON "OperationLog"("applicationId");
CREATE INDEX "OperationLog_supplierId_businessLine_idx" ON "OperationLog"("supplierId", "businessLine");

DO $$
DECLARE video_count INTEGER; audio_count INTEGER; pending_count INTEGER;
BEGIN
  SELECT count(*) INTO video_count FROM "CandidateApplication" WHERE "businessLine" = 'VIDEO';
  SELECT count(*) INTO audio_count FROM "CandidateApplication" WHERE "businessLine" = 'AUDIO';
  SELECT count(*) INTO pending_count FROM "CandidateApplication" WHERE "businessLine" = 'UNCLASSIFIED';
  RAISE NOTICE 'BusinessLine migration: VIDEO=%, AUDIO=%, UNCLASSIFIED=%', video_count, audio_count, pending_count;
END $$;
