import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('accessToken'))
  const user = ref(null)
  const isAuthenticated = computed(() => Boolean(token.value))

  async function authenticate(path, credentials) {
    const response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(body.detail ?? body.message ?? '인증에 실패했습니다.')

    token.value = body.accessToken
    user.value = body.user
    localStorage.setItem('accessToken', body.accessToken)
  }

  function login(credentials) {
    return authenticate('/auth/login', credentials)
  }

  function signup(credentials) {
    return authenticate('/auth/signup', credentials)
  }

  function logout() {
    token.value = null
    user.value = null
    localStorage.removeItem('accessToken')
  }

  return { token, user, isAuthenticated, login, signup, logout }
})
