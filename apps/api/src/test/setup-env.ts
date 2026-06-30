process.env.DATABASE_URL ??= 'postgresql://postgres:1234@localhost'
process.env.BETTER_AUTH_SECRET ??= 'spliit-test-secret'
process.env.BETTER_AUTH_URL ??= 'http://localhost:3001'
process.env.NODE_ENV ??= 'test'
process.env.WEB_ORIGINS ??= 'http://localhost:3000'
// Pre-seed S3 env so the upload route does not short-circuit with 503.
process.env.S3_UPLOAD_BUCKET ??= 'spliit-test-bucket'
process.env.S3_UPLOAD_KEY ??= 'AKIA-TEST'
process.env.S3_UPLOAD_REGION ??= 'us-east-1'
process.env.S3_UPLOAD_SECRET ??= 'test-secret'
process.env.S3_UPLOAD_ENDPOINT ??= ''
// Pre-seed social provider env so the auth module exposes Google + GitHub
// in its config (used by lib/auth tests). Real values are never exchanged
// here — the auth module is only inspected via `vi.importActual`, not started.
process.env.GOOGLE_CLIENT_ID ??= 'test-google-client-id'
process.env.GOOGLE_CLIENT_SECRET ??= 'test-google-client-secret'
process.env.GITHUB_CLIENT_ID ??= 'test-github-client-id'
process.env.GITHUB_CLIENT_SECRET ??= 'test-github-client-secret'
