ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'INTERVIEWER';

CREATE TYPE "FeaturePermission" AS ENUM (
  'CANDIDATE_VIEW',
  'CANDIDATE_CREATE',
  'CANDIDATE_IMPORT',
  'CANDIDATE_EDIT',
  'CANDIDATE_CONTACT_VIEW',
  'SCREENING_SUBMIT',
  'INTERVIEW_VIEW',
  'INTERVIEW_SCHEDULE',
  'FEEDBACK_VIEW',
  'FEEDBACK_SUBMIT',
  'LEVEL_ADJUSTMENT_REQUEST',
  'OFFER_MANAGE',
  'ONBOARDING_CONFIRM',
  'RECEPTION_VIEW',
  'DATA_EXPORT',
  'SUPPLIER_ACCOUNT_MANAGE'
);

CREATE TYPE "CalendarBlockType" AS ENUM (
  'LEAVE',
  'INTERNAL_MEETING',
  'TRAINING',
  'LUNCH_BREAK',
  'TEMPORARILY_UNAVAILABLE',
  'OTHER'
);

CREATE TYPE "CalendarRecurrence" AS ENUM ('SINGLE', 'WEEKLY');

ALTER TABLE "Supplier"
  ADD COLUMN "permissionCap" "FeaturePermission"[] NOT NULL DEFAULT ARRAY[]::"FeaturePermission"[],
  ADD COLUMN "businessLines" "BusinessLine"[] NOT NULL DEFAULT ARRAY['VIDEO', 'AUDIO']::"BusinessLine"[];

ALTER TABLE "User"
  ADD COLUMN "isSupplierManager" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "permissions" "FeaturePermission"[] NOT NULL DEFAULT ARRAY[]::"FeaturePermission"[],
  ADD COLUMN "businessLines" "BusinessLine"[] NOT NULL DEFAULT ARRAY[]::"BusinessLine"[],
  ADD COLUMN "kimUserId" TEXT;

ALTER TABLE "CandidateApplication" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Interview" ADD COLUMN "interviewerProfileId" TEXT;
ALTER TABLE "KimNotificationLog" ADD COLUMN "recipientUserId" TEXT;
ALTER TABLE "CandidateImportTask" ADD COLUMN "createdById" TEXT;
ALTER TABLE "ImportedDataset" ADD COLUMN "createdById" TEXT;

UPDATE "CandidateApplication"
SET "ownerId" = "createdById"
WHERE "createdById" IS NOT NULL;

UPDATE "User"
SET "isSupplierManager" = true
WHERE "role" = 'SUPPLIER_ADMIN';

UPDATE "CandidateApplication" AS application
SET "ownerId" = manager."id"
FROM "User" AS manager
WHERE manager."supplierId" = application."supplierId"
  AND manager."isSupplierManager" = true
  AND (
    application."ownerId" IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM "User" AS current_owner
      WHERE current_owner."id" = application."ownerId"
        AND current_owner."supplierId" = application."supplierId"
    )
  );

UPDATE "CandidateImportTask" AS task
SET "createdById" = account."id"
FROM "User" AS account
WHERE account."supplierId" = task."supplierId"
  AND account."name" = task."uploadedBy";

UPDATE "ImportedDataset" AS dataset
SET "createdById" = account."id"
FROM "User" AS account
WHERE account."supplierId" = dataset."supplierId"
  AND account."name" = dataset."createdBy";

UPDATE "User"
SET "businessLines" = CASE
  WHEN "role" IN ('VIDEO_RECRUITER', 'SUPPLIER_VIDEO_RECRUITER') THEN ARRAY['VIDEO']::"BusinessLine"[]
  WHEN "role" IN ('AUDIO_RECRUITER', 'SUPPLIER_AUDIO_RECRUITER') THEN ARRAY['AUDIO']::"BusinessLine"[]
  WHEN "role" IN ('PLATFORM_ADMIN', 'DEPARTMENT_MANAGER', 'INTERNAL_RECRUITER', 'SUPPLIER_ADMIN', 'SUPPLIER_RECRUITER') THEN ARRAY['VIDEO', 'AUDIO']::"BusinessLine"[]
  ELSE ARRAY[]::"BusinessLine"[]
END;

UPDATE "Supplier"
SET "permissionCap" = ARRAY[
  'CANDIDATE_VIEW', 'CANDIDATE_CREATE', 'CANDIDATE_IMPORT', 'CANDIDATE_EDIT',
  'CANDIDATE_CONTACT_VIEW', 'SCREENING_SUBMIT', 'INTERVIEW_VIEW', 'INTERVIEW_SCHEDULE',
  'FEEDBACK_VIEW', 'FEEDBACK_SUBMIT', 'LEVEL_ADJUSTMENT_REQUEST', 'OFFER_MANAGE',
  'ONBOARDING_CONFIRM', 'RECEPTION_VIEW', 'DATA_EXPORT', 'SUPPLIER_ACCOUNT_MANAGE'
]::"FeaturePermission"[];

UPDATE "User"
SET "permissions" = CASE
  WHEN "role" IN ('PLATFORM_ADMIN', 'DEPARTMENT_MANAGER', 'INTERNAL_RECRUITER', 'VIDEO_RECRUITER', 'AUDIO_RECRUITER') THEN ARRAY[
    'CANDIDATE_VIEW', 'CANDIDATE_CREATE', 'CANDIDATE_IMPORT', 'CANDIDATE_EDIT',
    'CANDIDATE_CONTACT_VIEW', 'SCREENING_SUBMIT', 'INTERVIEW_VIEW', 'INTERVIEW_SCHEDULE',
    'FEEDBACK_VIEW', 'FEEDBACK_SUBMIT', 'LEVEL_ADJUSTMENT_REQUEST', 'OFFER_MANAGE',
    'ONBOARDING_CONFIRM', 'RECEPTION_VIEW', 'DATA_EXPORT'
  ]::"FeaturePermission"[]
  WHEN "role" = 'SUPPLIER_ADMIN' THEN ARRAY[
    'CANDIDATE_VIEW', 'CANDIDATE_CREATE', 'CANDIDATE_IMPORT', 'CANDIDATE_EDIT',
    'CANDIDATE_CONTACT_VIEW', 'SCREENING_SUBMIT', 'INTERVIEW_VIEW', 'INTERVIEW_SCHEDULE',
    'FEEDBACK_VIEW', 'FEEDBACK_SUBMIT', 'LEVEL_ADJUSTMENT_REQUEST', 'OFFER_MANAGE',
    'ONBOARDING_CONFIRM', 'RECEPTION_VIEW', 'SUPPLIER_ACCOUNT_MANAGE'
  ]::"FeaturePermission"[]
  WHEN "role" IN ('SUPPLIER_VIDEO_RECRUITER', 'SUPPLIER_AUDIO_RECRUITER', 'SUPPLIER_RECRUITER') THEN ARRAY[
    'CANDIDATE_VIEW', 'CANDIDATE_CREATE', 'CANDIDATE_IMPORT', 'CANDIDATE_EDIT',
    'CANDIDATE_CONTACT_VIEW', 'SCREENING_SUBMIT', 'INTERVIEW_VIEW', 'INTERVIEW_SCHEDULE',
    'FEEDBACK_VIEW', 'FEEDBACK_SUBMIT', 'LEVEL_ADJUSTMENT_REQUEST', 'OFFER_MANAGE',
    'ONBOARDING_CONFIRM', 'RECEPTION_VIEW'
  ]::"FeaturePermission"[]
  ELSE ARRAY[]::"FeaturePermission"[]
END;

CREATE TABLE "InterviewerProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "department" TEXT,
  "businessLines" "BusinessLine"[] NOT NULL DEFAULT ARRAY[]::"BusinessLine"[],
  "positionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "workingDays" INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5],
  "workStartMinute" INTEGER NOT NULL DEFAULT 540,
  "workEndMinute" INTEGER NOT NULL DEFAULT 1260,
  "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InterviewerProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InterviewerCalendarBlock" (
  "id" TEXT NOT NULL,
  "interviewerId" TEXT NOT NULL,
  "type" "CalendarBlockType" NOT NULL,
  "title" TEXT NOT NULL,
  "reason" TEXT,
  "recurrence" "CalendarRecurrence" NOT NULL DEFAULT 'SINGLE',
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "weekday" INTEGER,
  "startMinute" INTEGER,
  "endMinute" INTEGER,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveTo" TIMESTAMP(3),
  "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InterviewerCalendarBlock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SiteNotification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "applicationId" TEXT,
  "interviewId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_kimUserId_key" ON "User"("kimUserId");
CREATE INDEX "User_isSupplierManager_status_idx" ON "User"("isSupplierManager", "status");
CREATE INDEX "CandidateApplication_ownerId_businessLine_currentStatus_idx" ON "CandidateApplication"("ownerId", "businessLine", "currentStatus");
CREATE INDEX "CandidateImportTask_createdById_uploadedAt_idx" ON "CandidateImportTask"("createdById", "uploadedAt");
CREATE INDEX "ImportedDataset_createdById_createdAt_idx" ON "ImportedDataset"("createdById", "createdAt");
CREATE INDEX "Interview_interviewerProfileId_scheduledStartTime_idx" ON "Interview"("interviewerProfileId", "scheduledStartTime");
CREATE UNIQUE INDEX "InterviewerProfile_userId_key" ON "InterviewerProfile"("userId");
CREATE INDEX "InterviewerProfile_status_idx" ON "InterviewerProfile"("status");
CREATE INDEX "InterviewerCalendarBlock_interviewerId_status_idx" ON "InterviewerCalendarBlock"("interviewerId", "status");
CREATE INDEX "InterviewerCalendarBlock_startAt_endAt_idx" ON "InterviewerCalendarBlock"("startAt", "endAt");
CREATE INDEX "InterviewerCalendarBlock_weekday_startMinute_endMinute_idx" ON "InterviewerCalendarBlock"("weekday", "startMinute", "endMinute");
CREATE UNIQUE INDEX "SiteNotification_idempotencyKey_key" ON "SiteNotification"("idempotencyKey");
CREATE INDEX "SiteNotification_userId_readAt_createdAt_idx" ON "SiteNotification"("userId", "readAt", "createdAt");
CREATE INDEX "SiteNotification_applicationId_idx" ON "SiteNotification"("applicationId");
CREATE INDEX "SiteNotification_interviewId_idx" ON "SiteNotification"("interviewId");

ALTER TABLE "CandidateApplication"
  ADD CONSTRAINT "CandidateApplication_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Interview"
  ADD CONSTRAINT "Interview_interviewerProfileId_fkey"
  FOREIGN KEY ("interviewerProfileId") REFERENCES "InterviewerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InterviewerProfile"
  ADD CONSTRAINT "InterviewerProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InterviewerCalendarBlock"
  ADD CONSTRAINT "InterviewerCalendarBlock_interviewerId_fkey"
  FOREIGN KEY ("interviewerId") REFERENCES "InterviewerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SiteNotification"
  ADD CONSTRAINT "SiteNotification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SiteNotification"
  ADD CONSTRAINT "SiteNotification_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "CandidateApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SiteNotification"
  ADD CONSTRAINT "SiteNotification_interviewId_fkey"
  FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
