# CRM Architecture

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Classification

CRM is a shared business capability. Core provides Person, OrganizationPerson, ContactPoint, Consent and Audit.

## 2. Entities

- Lead.
- PipelineDefinition.
- PipelineStage.
- LeadStageHistory.
- CRMTask.
- Interaction.
- SegmentDefinition.
- SourceAttribution.
- ConversionRecord.
- DuplicateCandidate.

## 3. Lifecycle

Normalized state:

```text
Open → Qualified → Converted
  ↘ Disqualified
```

Organization-specific stages map to normalized categories.

## 4. Conversion

- detect existing person candidates.
- require explicit link/merge.
- create/link OrganizationPerson.
- preserve lead history.
- create conversion record.
- publish event.
- avoid duplicate vertical client profiles.

## 5. Tasks

Task includes subject, assignee, due date, priority, status and audit.

## 6. Notes and Interactions

Versioned/edit history, visibility classification, sanitized rich text and references to messages/calls/meetings. Sensitive vertical notes stay outside generic CRM.

## 7. Segmentation

Allowlisted expression model, never raw SQL.

## 8. Events

LeadCreated, LeadStageChanged, LeadConverted, CrmTaskCreated, CrmTaskCompleted and DuplicateCandidateDetected.

## 9. Security

Consent before marketing, explicit private-note permission, audited export and suppression checks for bulk communication.
