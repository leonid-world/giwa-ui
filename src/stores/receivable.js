import { ref } from 'vue'
import { defineStore } from 'pinia'
import { apiRequest } from '../services/api'

export const useReceivableStore = defineStore('receivable', () => {
  const receivables = ref([])
  const fundingOpportunities = ref([])
  const selectedReceivable = ref(null)

  async function loadAll() {
    receivables.value = await apiRequest('/receivables')
  }

  async function loadOne(receivableId) {
    selectedReceivable.value = await apiRequest(`/receivables/${receivableId}`)
    return selectedReceivable.value
  }

  async function loadFundingOpportunities() {
    fundingOpportunities.value = await apiRequest('/receivables/funding-opportunities')
    return fundingOpportunities.value
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
    selectedReceivable.value = await apiRequest(`/receivables/${receivableId}/chain-created`, {
      method: 'POST',
      body: payload,
    })
    await loadAll()
    return selectedReceivable.value
  }

  async function markVerified(receivableId, payload) {
    selectedReceivable.value = await apiRequest(`/receivables/${receivableId}/verified`, {
      method: 'POST',
      body: payload,
    })
    await loadAll()
    return selectedReceivable.value
  }

  async function markTokenized(receivableId, payload) {
    selectedReceivable.value = await apiRequest(`/receivables/${receivableId}/tokenized`, {
      method: 'POST',
      body: payload,
    })
    await loadAll()
    return selectedReceivable.value
  }

  async function markFunded(receivableId, payload) {
    selectedReceivable.value = await apiRequest(`/receivables/${receivableId}/funded`, {
      method: 'POST',
      body: payload,
    })
    await Promise.all([loadAll(), loadFundingOpportunities()])
    return selectedReceivable.value
  }

  async function markRepaid(receivableId, payload) {
    selectedReceivable.value = await apiRequest(`/receivables/${receivableId}/repaid`, {
      method: 'POST',
      body: payload,
    })
    await loadAll()
    return selectedReceivable.value
  }

  return {
    receivables,
    fundingOpportunities,
    selectedReceivable,
    loadAll,
    loadOne,
    loadFundingOpportunities,
    clearSelection,
    create,
    markChainCreated,
    markVerified,
    markTokenized,
    markFunded,
    markRepaid,
  }
})
