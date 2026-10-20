import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

import { test as base, expect } from '@playwright/test'

const test = base.extend<{ deployment: { url: string; upgrade: () => void } }>({
  deployment: async ({ browserName: _browserName }, provide) => {
    let deployed = 'a'
    const server = createServer((request, response) => {
      const url = new URL(request.url!, 'http://localhost')
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      if (file.includes('..')) {
        response.writeHead(400).end()
        return
      }
      void readFile(
        path.join(
          import.meta.dirname,
          '../test-results/pwa-builds',
          deployed,
          file,
        ),
      )
        .then((body) => {
          response
            .writeHead(200, {
              'Content-Type': file.endsWith('.js')
                ? 'application/javascript'
                : file.endsWith('.json')
                  ? 'application/json'
                  : 'text/html',
              'Cache-Control': 'no-store',
            })
            .end(body)
        })
        .catch(() => response.writeHead(404).end())
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing server address')
    try {
      await provide({
        url: `http://127.0.0.1:${address.port}`,
        upgrade: () => {
          deployed = 'b'
        },
      })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  },
})

test('updates a single clean window without a refresh or browser restart', async ({
  page,
  deployment,
}) => {
  await page.goto(deployment.url)
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('#build')).toHaveText('a')
  await page.evaluate(() => navigator.serviceWorker.ready)
  deployment.upgrade()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('#build')).toHaveText('b')
  await expect(page.locator('#status')).toContainText('"status":"updated"')
})

test('checkpoints the latest edit during the five-second countdown and restores it once', async ({
  page,
  deployment,
}) => {
  await page.goto(deployment.url)
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.getByLabel('Expense title').fill('Dinner')
  deployment.upgrade()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('#status')).toContainText('"status":"countdown"')
  await expect(page.locator('#build')).toHaveText('a')
  await page.getByLabel('Expense title').fill('Dinner and dessert')
  await expect(page.locator('#build')).toHaveText('b')
  await expect(page.getByLabel('Expense title')).toHaveValue(
    'Dinner and dessert',
  )
  await expect(page.locator('#status')).toContainText('"restored":true')
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('spliit-pwa-expense-recovery'),
    ),
  ).toBeNull()
})

test('does not activate over unfinished work in another window', async ({
  page,
  context,
  deployment,
}) => {
  await page.goto(deployment.url)
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => navigator.serviceWorker.ready)
  const peer = await context.newPage()
  await peer.goto(deployment.url)
  await expect(peer.locator('html')).toHaveAttribute('data-ready', 'true')
  await peer.getByLabel('Other unfinished work').check()
  deployment.upgrade()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('#status')).toContainText('"status":"blocked"')
  await expect(page.locator('#build')).toHaveText('a')
  await expect(peer.locator('#build')).toHaveText('a')
  await peer.getByLabel('Other unfinished work').uncheck()
  await expect(page.locator('#build')).toHaveText('b')
  await expect(peer.locator('#build')).toHaveText('b')
})

test('Update now completes the handoff without waiting for the countdown', async ({
  page,
  deployment,
}) => {
  await page.goto(deployment.url)
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.getByLabel('Expense title').fill('Dinner')
  deployment.upgrade()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('#status')).toContainText('"seconds":5')
  await page.getByRole('button', { name: 'Update now' }).click()
  await expect(page.locator('#build')).toHaveText('b', { timeout: 4000 })
  await expect(page.getByLabel('Expense title')).toHaveValue('Dinner')
})

test('does not activate when the expense checkpoint cannot be stored', async ({
  page,
  deployment,
}) => {
  await page.goto(deployment.url)
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.getByLabel('Expense title').fill('Keep this draft')
  await page.evaluate(() => {
    const write = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'spliit-pwa-expense-recovery')
        throw new DOMException('Storage full', 'QuotaExceededError')
      write.call(this, key, value)
    }
  })
  deployment.upgrade()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('#status')).toContainText(
    '"status":"recovery-failed"',
  )
  await expect(page.locator('#build')).toHaveText('a')
  await expect(page.getByLabel('Expense title')).toHaveValue('Keep this draft')
  await expect(page.getByLabel('Expense title')).toBeEditable()
})
