import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import {
  setToken,
  setUserSessionCookie,
} from '@baserow/modules/core/utils/auth'

/**
 * Built-in Liangce smart table mode.
 * No Baserow login page and no platform ticket exchange: the local backend
 * provisions one internal workspace and returns its native session.
 */
export default defineNuxtPlugin({
  name: 'liangce-sso',
  dependsOn: ['create-store'],
  async setup(nuxtApp) {
    if (typeof window === 'undefined') return

    addLiangceBranding()

    if (nuxtApp.$store?.getters?.['auth/isAuthenticated']) return

    try {
      const config = useRuntimeConfig()
      const backend =
        config.public.publicBackendUrl ||
        config.public.publicApiUrl ||
        'http://127.0.0.1:8001'
      const resp = await fetch(
        `${backend.replace(/\/$/, '')}/api/liangce-embedded/bootstrap/`,
        {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        }
      )
      const data = await resp.json()
      if (!resp.ok || !data?.ok) {
        throw new Error(data?.error || `embedded bootstrap failed (${resp.status})`)
      }
      await applyTokens(nuxtApp, data)
      const path = window.location.pathname || '/'
      if (/login|signup|forgot|reset/i.test(path)) {
        window.location.replace('/')
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[liangce-sso] embedded bootstrap error', error)
      showSsoError(error)
    }
  },
})

async function applyTokens(nuxtApp, data) {
  const refresh = data.refresh_token
  const access = data.access_token || data.token
  if (!refresh) return

  await setToken(nuxtApp, refresh)
  if (data.user_session) {
    await setUserSessionCookie(nuxtApp, data.user_session)
  }

  if (nuxtApp.$store?.dispatch) {
    await nuxtApp.$store.dispatch('auth/setUserData', {
      ...data,
      access_token: access,
      refresh_token: refresh,
    })
  }
}

function addLiangceBranding() {
  // Embedded inside the Liangce platform iframe — no floating chrome.
  if (window.parent && window.parent !== window) return
}

function showSsoError(error) {
  const panel = document.createElement('div')
  panel.setAttribute('role', 'alert')
  panel.textContent = `智能表格初始化失败：${error?.message || error}`
  Object.assign(panel.style, {
    position: 'fixed',
    left: '50%',
    top: '20px',
    transform: 'translateX(-50%)',
    zIndex: '10001',
    padding: '12px 16px',
    border: '1px solid #d33',
    borderRadius: '8px',
    background: '#fff',
    color: '#a00',
    font: '14px/1.4 system-ui,sans-serif',
  })
  document.body.appendChild(panel)
}
