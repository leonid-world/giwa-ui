<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useWalletStore } from '../stores/wallet'

const router = useRouter()
const auth = useAuthStore()
const wallet = useWalletStore()
const errorMessage = ref('')
const isConnecting = ref(false)

onMounted(async () => {
  try {
    await wallet.loadWallet()
  } catch (error) {
    errorMessage.value = error.message
  }
})

async function connectWallet() {
  errorMessage.value = ''
  isConnecting.value = true
  try {
    await wallet.connect()
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    isConnecting.value = false
  }
}

function logout() {
  auth.logout()
  wallet.clear()
  router.push({ name: 'login' })
}
</script>

<template>
  <main class="dashboard">
    <section>
      <p class="eyebrow">GIWA RECEIVABLE FINANCE</p>
      <h1>로그인되었습니다.</h1>
      <p>회사 지갑을 MetaMask와 연결하세요. 개인 키는 저장되지 않습니다.</p>
      <div class="wallet-card">
        <span>회사 지갑</span>
        <strong v-if="wallet.isConnected">{{ wallet.walletAddress }}</strong>
        <strong v-else>연결된 지갑 없음</strong>
        <button type="button" :disabled="isConnecting" @click="connectWallet">
          {{ isConnecting ? '연결 중...' : wallet.isConnected ? '지갑 변경' : 'MetaMask 연결' }}
        </button>
      </div>
      <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
      <button type="button" :disabled="!wallet.isConnected" @click="router.push({ name: 'receivables' })">
        매출채권 관리
      </button>
      <button type="button" @click="logout">로그아웃</button>
    </section>
  </main>
</template>

<style scoped>
.dashboard {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}
section {
  width: min(100%, 580px);
  padding: 40px;
  border-radius: 16px;
  background: white;
  box-shadow: 0 20px 50px rgba(24, 62, 48, 0.08);
}
.eyebrow {
  color: #0b7654;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
h1 {
  margin: 8px 0;
  color: #15352b;
  font-size: 30px;
  font-weight: 700;
}
p {
  color: #62736b;
}
.wallet-card {
  display: grid;
  gap: 8px;
  margin-top: 24px;
  padding: 20px;
  border: 1px solid #dfe5e1;
  border-radius: 12px;
}
.wallet-card span {
  color: #62736b;
  font-size: 14px;
}
.wallet-card strong {
  overflow-wrap: anywhere;
  color: #15352b;
}
button {
  margin-top: 24px;
  border: 0;
  border-radius: 8px;
  padding: 12px 16px;
  background: #0b7654;
  color: white;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}
.wallet-card button {
  margin-top: 8px;
}
button:disabled {
  cursor: wait;
  opacity: 0.65;
}
.error {
  margin-top: 16px;
  color: #ba1a1a;
}
</style>
