'use client'

import { useCallback, useEffect, useState } from 'react'

type SyncUser = {
  id: string
  email: string
}

type SyncAuthState = {
  isAuthenticated: boolean
  user: SyncUser | null
  isLoading: boolean
}

type SyncSessionResponse = {
  user: SyncUser
}

const SESSION_STORAGE_KEY = 'spliit_sync_session'

const validateSessionToken = async (token: string): Promise<SyncUser> => {
  const response = await fetch('/api/auth/session', {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    throw new Error('Invalid session')
  }

  const data = (await response.json()) as SyncSessionResponse
  return data.user
}

export function useSyncAuth() {
  const [state, setState] = useState<SyncAuthState>({
    isAuthenticated: false,
    user: null,
    isLoading: true,
  })

  const updateStateFromToken = useCallback(async (token: string) => {
    setState((current) => ({ ...current, isLoading: true }))

    try {
      const user = await validateSessionToken(token)
      setState({ isAuthenticated: true, user, isLoading: false })
    } catch {
      localStorage.removeItem(SESSION_STORAGE_KEY)
      setState({ isAuthenticated: false, user: null, isLoading: false })
    }
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)
    const sessionToken = url.searchParams.get('session')

    if (sessionToken) {
      localStorage.setItem(SESSION_STORAGE_KEY, sessionToken)
      url.searchParams.delete('session')
      window.history.replaceState({}, '', url.toString())
      void updateStateFromToken(sessionToken)
      return
    }

    const storedToken = localStorage.getItem(SESSION_STORAGE_KEY)
    if (storedToken) {
      void updateStateFromToken(storedToken)
    } else {
      setState((current) => ({ ...current, isLoading: false }))
    }
  }, [updateStateFromToken])

  const login = useCallback(async (email: string) => {
    const response = await fetch('/api/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(data?.error ?? 'Failed to request magic link')
    }
  }, [])

  const setSession = useCallback(
    (token: string) => {
      localStorage.setItem(SESSION_STORAGE_KEY, token)
      void updateStateFromToken(token)
    },
    [updateStateFromToken],
  )

  const logout = useCallback(async () => {
    const token = localStorage.getItem(SESSION_STORAGE_KEY)
    if (token) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      localStorage.removeItem(SESSION_STORAGE_KEY)
    }
    setState({ isAuthenticated: false, user: null, isLoading: false })
  }, [])

  const logoutAll = useCallback(async () => {
    const token = localStorage.getItem(SESSION_STORAGE_KEY)
    if (token) {
      await fetch('/api/auth/logout-all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      localStorage.removeItem(SESSION_STORAGE_KEY)
    }
    setState({ isAuthenticated: false, user: null, isLoading: false })
  }, [])

  const deleteAccount = useCallback(async () => {
    const token = localStorage.getItem(SESSION_STORAGE_KEY)
    if (token) {
      await fetch('/api/auth/account', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      localStorage.removeItem(SESSION_STORAGE_KEY)
    }
    setState({ isAuthenticated: false, user: null, isLoading: false })
  }, [])

  const getAuthHeader = useCallback(() => {
    const token = localStorage.getItem(SESSION_STORAGE_KEY)
    return token ? { Authorization: `Bearer ${token}` } : {}
  }, [])

  const getSessionToken = useCallback(() => {
    return localStorage.getItem(SESSION_STORAGE_KEY)
  }, [])

  return {
    ...state,
    login,
    setSession,
    logout,
    logoutAll,
    deleteAccount,
    getAuthHeader,
    getSessionToken,
  }
}
