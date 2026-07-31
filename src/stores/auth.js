import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { apiRequest } from '../services/api'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('accessToken'))
  const user = ref(null)
  const isAuthenticated = computed(() => Boolean(token.value))
  let userRequest = null
  let userRequestToken = null

  async function authenticate(path, credentials) {
    const body = await apiRequest(path, {
      method: 'POST',
      auth: false,
      body: credentials,
    })

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

  async function loadUser() {
    if (!token.value) {
      user.value = null
      return null
    }
    if (user.value) return user.value

    const requestedToken = token.value
    if (!userRequest || userRequestToken !== requestedToken) {
      userRequestToken = requestedToken
      const request = apiRequest('/auth/me')
        .then((body) => {
          if (token.value === requestedToken) user.value = body
          return body
        })
        .finally(() => {
          if (userRequest === request) {
            userRequest = null
            userRequestToken = null
          }
        })
      userRequest = request
    }
    return userRequest
  }

  function logout() {
    token.value = null
    user.value = null
    localStorage.removeItem('accessToken')
  }

  return { token, user, isAuthenticated, login, signup, loadUser, logout }
})
