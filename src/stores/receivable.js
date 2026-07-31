import { ref } from 'vue'
import { defineStore } from 'pinia'
import { apiRequest } from '../services/api'

export const useReceivableStore = defineStore('receivable', () => {
  const receivables = ref([])
  const selectedReceivable = ref(null)

  async function loadAll() {
    receivables.value = await apiRequest('/receivables')
  }

  async function loadOne(receivableId) {
    selectedReceivable.value = await apiRequest(`/receivables/${receivableId}`)
    return selectedReceivable.value
  }

  function clearSelection() {
    selectedReceivable.value = null
  }

  async function create(payload) {
    const body = await apiRequest('/receivables', {
      method: 'POST',
      body: payload,
    })
    selectedReceivable.value = body
    await loadAll()
    return body
  }

  async function markChainCreated(receivableId, payload) {
    selectedReceivable.value = await apiRequest(
      `/receivables/${receivableId}/chain-created`,
      {
        method: 'POST',
        body: payload,
      },
    )
    await loadAll()
    return selectedReceivable.value
  }

  async function markVerified(receivableId, payload) {
    selectedReceivable.value = await apiRequest(
      `/receivables/${receivableId}/verified`,
      {
        method: 'POST',
        body: payload,
      },
    )
    await loadAll()
    return selectedReceivable.value
  }

  async function markTokenized(receivableId, payload) {
    selectedReceivable.value = await apiRequest(
      `/receivables/${receivableId}/tokenized`,
      {
        method: 'POST',
        body: payload,
      },
    )
    await loadAll()
    return selectedReceivable.value
  }

  return {
    receivables,
    selectedReceivable,
    loadAll,
    loadOne,
    clearSelection,
    create,
    markChainCreated,
    markVerified,
    markTokenized,
  }
})
