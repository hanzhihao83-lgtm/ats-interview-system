CREATE TYPE "InterviewFeedbackStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'OVERDUE');
CREATE TYPE "OfferStatus" AS ENUM ('PENDING_INITIATION', 'SENT', 'CANDIDATE_CONFIRMED', 'REJECTED', 'EXPIRED');
CREATE TYPE "LevelAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');
CREATE TYPE "OnboardingResult" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED');
CREATE TYPE "ReceptionTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "SchedulingRequestStatus" AS ENUM ('PENDING', 'BOOKED', 'EXPIRED', 'CANCELLED');

ALTER TABLE "JobPosition" ADD COLUMN "feedbackTemplate" JSONB;
ALTER TABLE "Interview" ADD COLUMN "feedbackDueAt" TIMESTAMP(3);
ALTER TABLE "OperationLog" ADD COLUMN "operatorId" TEXT;
ALTER TABLE "KimNotificationLog" ADD COLUMN "idempotencyKey" TEXT;

CREATE TABLE "ApplicationStatusEvent" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "operatorId" TEXT NOT NULL,
  "operatorName" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InterviewFeedback" (
  "id" TEXT NOT NULL,
  "interviewId" TEXT NOT NULL,
  "templateVersion" TEXT NOT NULL,
  "dimensionScores" JSONB NOT NULL,
  "comment" TEXT NOT NULL,
  "status" "InterviewFeedbackStatus" NOT NULL DEFAULT 'DRAFT',
  "dueAt" TIMESTAMP(3) NOT NULL,
  "submittedById" TEXT,
  "submittedByName" TEXT,
  "submittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InterviewFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InterviewConclusion" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "finalResult" TEXT NOT NULL,
  "finalLevel" TEXT,
  "roundSummary" JSONB NOT NULL,
  "decidedById" TEXT NOT NULL,
  "decidedByName" TEXT NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InterviewConclusion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Offer" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "status" "OfferStatus" NOT NULL DEFAULT 'PENDING_INITIATION',
  "initiatedById" TEXT NOT NULL,
  "initiatedByName" TEXT NOT NULL,
  "sentById" TEXT,
  "sentByName" TEXT,
  "sentAt" TIMESTAMP(3),
  "candidateRespondedAt" TIMESTAMP(3),
  "expiredAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobLevelAdjustment" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "requestedLevel" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "LevelAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
  "requestedById" TEXT NOT NULL,
  "requestedByName" TEXT NOT NULL,
  "reviewedById" TEXT,
  "reviewedByName" TEXT,
  "reviewComment" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobLevelAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OnboardingConfirmation" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "result" "OnboardingResult" NOT NULL DEFAULT 'PENDING',
  "entryDate" TIMESTAMP(3),
  "confirmedById" TEXT NOT NULL,
  "confirmedByName" TEXT NOT NULL,
  "note" TEXT,
  "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnboardingConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReceptionTask" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "assigneeId" TEXT,
  "assigneeName" TEXT NOT NULL,
  "status" "ReceptionTaskStatus" NOT NULL DEFAULT 'PENDING',
  "dueAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "completedById" TEXT,
  "completedByName" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReceptionTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReceptionChecklistItem" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "completedById" TEXT,
  "completedByName" TEXT,
  "completedAt" TIMESTAMP(3),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReceptionChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SavedFilter" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "filters" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedFilter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InterviewSchedulingRequest" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "interviewer" TEXT NOT NULL,
  "round" INTEGER NOT NULL DEFAULT 1,
  "roundName" TEXT NOT NULL,
  "proposedSlots" JSONB NOT NULL,
  "bookedSlot" JSONB,
  "status" "SchedulingRequestStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "bookedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InterviewSchedulingRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KimNotificationLog_idempotencyKey_key" ON "KimNotificationLog"("idempotencyKey");
CREATE INDEX "ApplicationStatusEvent_applicationId_occurredAt_idx" ON "ApplicationStatusEvent"("applicationId", "occurredAt");
CREATE INDEX "ApplicationStatusEvent_operatorId_occurredAt_idx" ON "ApplicationStatusEvent"("operatorId", "occurredAt");
CREATE UNIQUE INDEX "InterviewFeedback_interviewId_key" ON "InterviewFeedback"("interviewId");
CREATE INDEX "InterviewFeedback_status_dueAt_idx" ON "InterviewFeedback"("status", "dueAt");
CREATE INDEX "InterviewFeedback_submittedById_submittedAt_idx" ON "InterviewFeedback"("submittedById", "submittedAt");
CREATE UNIQUE INDEX "InterviewConclusion_applicationId_key" ON "InterviewConclusion"("applicationId");
CREATE INDEX "InterviewConclusion_decidedById_decidedAt_idx" ON "InterviewConclusion"("decidedById", "decidedAt");
CREATE INDEX "Offer_applicationId_createdAt_idx" ON "Offer"("applicationId", "createdAt");
CREATE INDEX "Offer_status_updatedAt_idx" ON "Offer"("status", "updatedAt");
CREATE UNIQUE INDEX "Offer_one_active_per_application_key" ON "Offer"("applicationId") WHERE "status" IN ('PENDING_INITIATION', 'SENT');
CREATE INDEX "JobLevelAdjustment_applicationId_createdAt_idx" ON "JobLevelAdjustment"("applicationId", "createdAt");
CREATE INDEX "JobLevelAdjustment_status_createdAt_idx" ON "JobLevelAdjustment"("status", "createdAt");
CREATE UNIQUE INDEX "JobLevelAdjustment_one_pending_per_application_key" ON "JobLevelAdjustment"("applicationId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "OnboardingConfirmation_applicationId_key" ON "OnboardingConfirmation"("applicationId");
CREATE UNIQUE INDEX "ReceptionTask_applicationId_key" ON "ReceptionTask"("applicationId");
CREATE INDEX "ReceptionTask_status_dueAt_idx" ON "ReceptionTask"("status", "dueAt");
CREATE INDEX "ReceptionTask_assigneeId_status_idx" ON "ReceptionTask"("assigneeId", "status");
CREATE INDEX "ReceptionChecklistItem_taskId_sortOrder_idx" ON "ReceptionChecklistItem"("taskId", "sortOrder");
CREATE UNIQUE INDEX "SavedFilter_userId_module_name_key" ON "SavedFilter"("userId", "module", "name");
CREATE INDEX "SavedFilter_userId_module_idx" ON "SavedFilter"("userId", "module");
CREATE UNIQUE INDEX "InterviewSchedulingRequest_tokenHash_key" ON "InterviewSchedulingRequest"("tokenHash");
CREATE INDEX "InterviewSchedulingRequest_applicationId_createdAt_idx" ON "InterviewSchedulingRequest"("applicationId", "createdAt");
CREATE INDEX "InterviewSchedulingRequest_status_expiresAt_idx" ON "InterviewSchedulingRequest"("status", "expiresAt");
CREATE UNIQUE INDEX "InterviewSchedulingRequest_one_pending_per_application_key" ON "InterviewSchedulingRequest"("applicationId") WHERE "status" = 'PENDING';

ALTER TABLE "ApplicationStatusEvent" ADD CONSTRAINT "ApplicationStatusEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CandidateApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterviewFeedback" ADD CONSTRAINT "InterviewFeedback_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterviewConclusion" ADD CONSTRAINT "InterviewConclusion_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CandidateApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CandidateApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobLevelAdjustment" ADD CONSTRAINT "JobLevelAdjustment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CandidateApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OnboardingConfirmation" ADD CONSTRAINT "OnboardingConfirmation_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CandidateApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReceptionTask" ADD CONSTRAINT "ReceptionTask_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CandidateApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReceptionChecklistItem" ADD CONSTRAINT "ReceptionChecklistItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ReceptionTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterviewSchedulingRequest" ADD CONSTRAINT "InterviewSchedulingRequest_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CandidateApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
