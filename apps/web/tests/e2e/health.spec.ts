import { expect, test } from '@playwright/test'

const apiUrl = process.env.VITE_API_URL ?? 'http://localhost:3001'

test('/health/liveness returns 200', async ({ request }) => {
  const response = await request.get(`${apiUrl}/health/liveness`)
  expect(response.status()).toBe(200)

  const body = await response.json()
  expect(body).toBeTruthy()
})

test('/health/readiness checks DB', async ({ request }) => {
  const response = await request.get(`${apiUrl}/health/readiness`)
  const expectedStatus =
    process.env.POSTGRES_PRISMA_URL && process.env.POSTGRES_URL_NON_POOLING
      ? 200
      : 503

  expect(response.status()).toBe(expectedStatus)

  const body = await response.json()
  expect(body).toBeTruthy()
})
