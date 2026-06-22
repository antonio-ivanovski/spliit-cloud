#!/bin/bash

set -euxo pipefail

pnpm --filter @spliit/db prisma-migrate
exec pnpm --filter @spliit/api start
