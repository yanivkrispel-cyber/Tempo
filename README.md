# Tempo

[![Build Status](https://img.shields.io/badge/build-in_progress-yellow)]()

## Overview

Tempo is a full-stack application platform with multiple web clients and a .NET backend.

## Structure

```
tempo/
├── apps/           # Frontend applications
├── backend/        # .NET backend services
├── infrastructure/ # Infrastructure scripts & configs
├── tests/          # Test projects
├── contracts/      # API contracts & schemas
├── tools/          # Development tools
└── docs/           # Documentation
```

## Prerequisites

- .NET 10 SDK
- Node.js 22+
- PNPM 10+
- Docker & Docker Compose

## Getting Started

```bash
# Clone the repo
git clone <repo-url>
cd tempo

# Build .NET backend
dotnet restore Tempo.sln
dotnet build Tempo.sln

# Install frontend/infrastructure dependencies
pnpm install

# Start local dependencies (PostgreSQL, Azurite)
docker compose -f docker-compose.local.yml up -d

# Run the API (Kestrel locally; auto-detects Lambda when deployed)
dotnet run --project backend/Tempo.Api

# Run the database migrator locally (see backend/Tempo.DatabaseMigrator).
# SSL is off by default here because the docker-compose PostgreSQL has no TLS;
# set DATABASE_SSL_MODE=Require for a database that needs it. The deployed
# Lambda always requires SSL.
DATABASE_HOST=localhost DATABASE_PORT=5432 DATABASE_NAME=tempo \
  DATABASE_MASTER_USERNAME=tempo DATABASE_MASTER_PASSWORD=tempo \
  dotnet run --project backend/Tempo.DatabaseMigrator
```

## Required commands

```bash
dotnet restore
dotnet build
dotnet test

pnpm install
pnpm build
pnpm test
pnpm lint

cd infrastructure
pnpm test
npx cdk synth
npx cdk diff      # requires AWS credentials for the target account
npx cdk deploy 'TempoDev/*' --require-approval never
```

See [`infrastructure/README.md`](infrastructure/README.md) for the full CDK
stack list, environment configuration reference, GitHub OIDC setup steps,
cost-sensitive decisions and known limitations.

## Deploying development and running the smoke test

`deploy-development.yml` runs automatically on push to `main` via GitHub
Actions using AWS OIDC (no static AWS keys). To run the smoke test manually
against an already-deployed environment:

```bash
node tools/scripts/smoke-test.mjs --api-url https://<api-id>.execute-api.eu-central-1.amazonaws.com --environment dev
```

## License

MIT
