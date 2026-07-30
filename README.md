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
dotnet build Tempo.sln

# Install frontend dependencies
pnpm install

# Start local dependencies
docker compose -f docker-compose.local.yml up -d

# Run the API
dotnet run --project backend/Tempo.Api
```

## License

MIT
