import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useAuthStore } from './auth'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'

export const useReceivableStore = defineStore('receivable', () => {
  const receivables = ref([])
  const selectedReceivable = ref(null)

  function authorizationHeaders() {
    const auth = useAuthStore()
    return { Authorization: `Bearer ${auth.token}` }
  }

  async function loadAll() {
    const response = await fetch(`${API_URL}/receivables`, {
      headers: authorizationHeaders(),
    })
    if (!response.ok) throw new Error('매출채권 목록을 불러오지 못했습니다.')
    receivables.value = await response.json()
  }

  async function loadOne(receivableId) {
    const response = await fetch(`${API_URL}/receivables/${receivableId}`, {
      headers: authorizationHeaders(),
    })
    if (!response.ok) throw new Error('매출채권 상세 정보를 불러오지 못했습니다.')
    selectedReceivable.value = await response.json()
    return selectedReceivable.value
  }

  async function create(payload) {
    const response = await fetch(`${API_URL}/receivables`, {
      method: 'POST',
      headers: {
        ...authorizationHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const body = await response.json()
    if (!response.ok) {
      throw new Error(body.detail ?? body.message ?? '매출채권 등록에 실패했습니다.')
    }
    selectedReceivable.value = body
    await loadAll()
    return body
  }

  return { receivables, selectedReceivable, loadAll, loadOne, create }
})
