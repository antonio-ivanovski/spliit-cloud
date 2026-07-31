// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { getApiBaseUrl } from './api-url'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getApiBaseUrl', () => {
  it('uses the current origin for the default same-origin deployment', () => {
    vi.stubEnv('VITE_API_URL', '')
    expect(getApiBaseUrl()).toBe(window.location.origin)
  })

  it('retains the build-time override for split-origin deployments', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.spliit.example/')
    expect(getApiBaseUrl()).toBe('https://api.spliit.example')
  })
})
