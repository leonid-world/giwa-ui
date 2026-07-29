import { BrowserProvider } from 'ethers'
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useAuthStore } from './auth'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'

function getMetaMaskProvider() {
  const injectedProvider = window.ethereum
  if (!injectedProvider) return null

  const providers = injectedProvider.providers ?? [injectedProvider]
  return providers.find((provider) => provider.isMetaMask && !provider.isPhantom) ?? null
}

export const useWalletStore = defineStore('wallet', () => {
  const walletAddress = ref(null)
  const isConnected = computed(() => Boolean(walletAddress.value))

  async function loadWallet() {
    const auth = useAuthStore()
    const response = await fetch(`${API_URL}/wallet/me`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
    if (response.status === 404) return
    if (!response.ok) throw new Error('연결된 지갑 정보를 불러오지 못했습니다.')
    walletAddress.value = (await response.json()).walletAddress
  }

  async function connect() {
    const metaMaskProvider = getMetaMaskProvider()
    if (!metaMaskProvider) {
      throw new Error('MetaMask provider를 찾지 못했습니다. 확장 프로그램을 활성화한 뒤 페이지를 새로고침해 주세요.')
    }

    const accounts = await metaMaskProvider.request({ method: 'eth_requestAccounts' })
    if (!accounts?.length) throw new Error('MetaMask 계정을 선택해 주세요.')

    const provider = new BrowserProvider(metaMaskProvider)
    const network = await provider.getNetwork()
    const address = accounts[0]
    const auth = useAuthStore()
    const response = await fetch(`${API_URL}/wallet/connect`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ walletAddress: address, chainId: Number(network.chainId) }),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(body.detail ?? body.message ?? '지갑 연결에 실패했습니다.')
    walletAddress.value = body.walletAddress
  }

  function clear() {
    walletAddress.value = null
  }

  return { walletAddress, isConnected, loadWallet, connect, clear }
})
