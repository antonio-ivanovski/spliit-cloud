# Features

## Optional Features (Environment Variables)

Features controlled via env vars, defined in `src/lib/featureFlags.ts`:

| Feature           | Env Variable                           | Requirements    |
| ----------------- | -------------------------------------- | --------------- |
| Expense Documents | `NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS` | AWS S3 setup    |
| Receipt Scanning  | `NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT`   | S3 + OpenAI API |
| Auto Category     | `NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT`  | OpenAI API      |

## Environment Variables

See `.env.example` for full list. Key ones:

```bash
# Required
POSTGRES_PRISMA_URL          # PostgreSQL connection (pooled)
POSTGRES_URL_NON_POOLING     # Direct PostgreSQL connection

# Optional
NEXT_PUBLIC_DEFAULT_CURRENCY_CODE  # Default currency for new groups
NEXT_PUBLIC_ENABLE_*               # Feature flags (see above)
OPENAI_API_KEY                     # For AI features
```

## Health Check Endpoints

| Endpoint                    | Purpose                                   |
| --------------------------- | ----------------------------------------- |
| `GET /api/health/readiness` | Full health check (database connectivity) |
| `GET /api/health/liveness`  | Application running check                 |
| `GET /api/health`           | Alias for readiness                       |
