# File Storage Architecture

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Design

**Decision (D17, 2026-10-17):** the first files are pictures (class covers, instructor photos, the studio cover, avatars) in one private S3 bucket per environment, served by short-lived presigned URLs; every picture is decoded and re-encoded to WebP on the server, which replaces the malware scan for images. Details: `33_Studio_Experience_LLD.md` section 6. Documents (PDFs, signed forms) keep the full flow below, scan included, when they arrive.

Binary in object storage; metadata and lifecycle in PostgreSQL.

## 2. File Metadata

- ID and organization.
- owner type/ID.
- purpose/classification.
- name/media type/size/checksum.
- object key.
- status and scan status.
- retention.
- creator and timestamps.

## 3. Upload Flow

Request session → pending record → signed upload → finalize → verify checksum → scan → clean/quarantine.

## 4. Access

Short-lived signed URLs after permission, tenant and classification checks. Sensitive files are never public.

## 5. Security

Type allowlist, size limits, malware scan, quarantine, image metadata removal, encryption, environment separation and non-executable upload buckets.

## 6. Retention

Policy-driven asynchronous purge with legal hold and audit.

## 7. Reconciliation

Detect pending uploads, missing objects, orphan objects and failed scans.
