# Troubleshooting

## Database Issues

**Connection failures**

- Ensure PostgreSQL is running: `./scripts/start-local-db.sh`
- Verify connection strings in `.env`

**Prisma Client errors**

```bash
npx prisma generate  # Regenerate client after schema changes
```

## Type Errors

```bash
npm check-types  # See all TypeScript issues
```

## Feature Flags Not Working

- Verify `NEXT_PUBLIC_ENABLE_*` env vars are set
- For AI features: check `OPENAI_API_KEY` is valid
- For S3 features: verify AWS credentials
