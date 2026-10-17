# ADR-0026: Field-Level Encryption Without a Customer-Managed Key Until Revenue

- **Status:** Accepted
- **Date:** 2026-10-17
- **Approved by:** Kris (day board #232, "health declaration on the $0 path")
- **Owners:** Engineering (Kris's machine: backend, infrastructure)
- **Related:** ADR-0015 (storage, secrets and encryption), ADR-0021 (zero fixed cost until revenue), ADR-0022
  (Neon), `docs/31_Health_Declaration_LLD.md`

## Context

The health declaration (`docs/31`) makes Tempo store health data: yes or no answers about a person's health, the
name they signed and, for a minor, a guardian's name. Neon encrypts the database at rest, but that protects only the
disks. Anyone who holds a connection string, a Neon branch, a restore or a dump reads every column in plain text.
Health answers need a second layer that the database alone cannot open.

ADR-0021 lists "sensitive data, such as health declarations" as a tripwire: one customer-managed KMS key for
field-level encryption, $1 per month. Tempo has no revenue yet, and the owners decided on 2026-10-17 not to fire that
tripwire for the pilot.

## Decision

1. Health declaration fields that hold health data or a signer's name are encrypted in the application with
   AES-256-GCM before they reach the database. The database stores ciphertext and the key version per row.
2. The data key is 32 random bytes in an SSM Parameter Store **SecureString**, standard tier, encrypted by the
   AWS-managed `aws/ssm` key. One parameter per environment and key version:
   `/tempo/{env}/health/data-key/{version}`. No customer-managed KMS key, no Secrets Manager secret: $0 fixed cost.
3. A tools script creates the parameter once per environment, as with the VAPID keys. CloudFormation cannot create
   SecureStrings, and the key never passes through a template, a log or the repository.
4. The API reads the key on first use and keeps it in memory for the container's life. Only the API's role may read
   the parameter path; the worker never reads it.
5. Every ciphertext carries associated data (studio, row, column, key version), and decryption fails closed.
6. **At revenue** (the ADR-0021 tripwire for the first paying studio), this moves to a customer-managed KMS key:
   either the key encrypts the SSM parameter (the smallest change), or it becomes the envelope key for per-row data
   keys. The decision is made then, with that cost.

## Cost

| Item | Fixed | Variable |
|---|---|---|
| SSM standard SecureString | $0 | $0 (standard throughput) |
| `aws/ssm` AWS-managed key | $0 | KMS requests: a few a day with the in-memory cache, inside the 20,000 free requests a month |
| AES-GCM in the Lambda | $0 | CPU microseconds |

## Consequences

- A leaked database, branch or dump holds no readable health data.
- The key's protection is the account's IAM, not a key policy: anyone with broad SSM rights in the account can read
  it. CloudTrail records each read. A customer-managed key with a narrow key policy closes this at revenue.
- Rotation is the application's job: a new parameter version, a deploy, a re-encrypt of old rows, then the old
  parameter is deleted (`docs/31` section 7.1). Part one documents it; the re-encrypt command is built before the
  first rotation.
- Losing the parameter makes the answers unreadable. Statuses still work and members sign again. A production
  backup of the key is an open decision for Kris.
- The same pattern serves any later sensitive field, each with its own parameter path.
