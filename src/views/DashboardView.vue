<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useWalletStore } from '../stores/wallet'

const router = useRouter()
const auth = useAuthStore()
const wallet = useWalletStore()
const errorMessage = ref('')
const errorCode = ref('')
const successMessage = ref('')
const isSelecting = ref(false)
const isConnecting = ref(false)

onMounted(async () => {
  try {
    await wallet.loadWallet()
  } catch (error) {
    showError(error)
  }
})

async function selectWalletAccount() {
  errorMessage.value = ''
  errorCode.value = ''
  successMessage.value = ''
  isSelecting.value = true
  try {
    await wallet.selectAccount()
  } catch (error) {
    showError(error)
  } finally {
    isSelecting.value = false
  }
}

async function confirmWalletConnection() {
  errorMessage.value = ''
  errorCode.value = ''
  successMessage.value = ''
  isConnecting.value = true
  try {
    await wallet.confirmConnection()
    successMessage.value = '회사 지갑이 연결되었습니다.'
  } catch (error) {
    showError(error)
  } finally {
    isConnecting.value = false
  }
}

function cancelWalletSelection() {
  wallet.clearPending()
  errorMessage.value = ''
  errorCode.value = ''
}

function showError(error) {
  errorMessage.value = error.message ?? '요청을 처리하지 못했습니다.'
  errorCode.value = error.code ?? ''
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
        <span>현재 회사 지갑</span>
        <strong v-if="wallet.isConnected">{{ wallet.walletAddress }}</strong>
        <strong v-else>연결된 지갑 없음</strong>

        <button
          v-if="!wallet.hasPendingWallet"
          type="button"
          :disabled="isSelecting"
          @click="selectWalletAccount"
        >
          {{ isSelecting ? 'MetaMask 확인 중...' : wallet.isConnected ? '다른 계정 선택' : 'MetaMask 계정 선택' }}
        </button>

        <div
          v-if="wallet.hasPendingWallet && errorCode !== 'WALLET_ALREADY_MAPPED'"
          class="wallet-confirmation"
        >
          <span>선택한 MetaMask 계정</span>
          <strong>{{ wallet.pendingWalletAddress }}</strong>
          <p>이 주소를 회사 지갑으로 연결하시겠습니까?</p>
          <div class="confirmation-actions">
            <button type="button" :disabled="isConnecting" @click="confirmWalletConnection">
              {{ isConnecting ? '연결 중...' : '이 지갑 연결' }}
            </button>
            <button class="secondary" type="button" :disabled="isSelecting" @click="selectWalletAccount">
              다른 계정 선택
            </button>
            <button class="text-button" type="button" @click="cancelWalletSelection">취소</button>
          </div>
        </div>
      </div>

      <div v-if="errorCode === 'WALLET_ALREADY_MAPPED'" class="conflict-alert" role="alert">
        <strong>이미 등록된 MetaMask 지갑입니다.</strong>
        <p>{{ wallet.pendingWalletAddress }}</p>
        <p>이 주소는 다른 회사에서 사용 중입니다. 해당 회사용으로 분리된 MetaMask 계정을 선택해 주세요.</p>
        <div class="confirmation-actions">
          <button type="button" :disabled="isSelecting" @click="selectWalletAccount">
            {{ isSelecting ? 'MetaMask 확인 중...' : '다른 계정 선택' }}
          </button>
          <button class="text-button danger" type="button" @click="cancelWalletSelection">닫기</button>
        </div>
      </div>
      <p v-else-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="success" role="status">{{ successMessage }}</p>
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
.wallet-confirmation {
  display: grid;
  gap: 8px;
  margin-top: 14px;
  padding-top: 16px;
  border-top: 1px solid #dfe5e1;
}
.confirmation-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.confirmation-actions button {
  margin-top: 4px;
}
.secondary {
  border: 1px solid #9eb2a8;
  background: white;
  color: #315548;
}
.text-button {
  background: transparent;
  color: #52675e;
}
.conflict-alert {
  margin-top: 16px;
  padding: 18px;
  border: 1px solid #efb4b4;
  border-radius: 10px;
  background: #fff4f4;
}
.conflict-alert strong,
.conflict-alert p {
  color: #8f1717;
}
.danger {
  color: #8f1717;
}
button:disabled {
  cursor: wait;
  opacity: 0.65;
}
.error {
  margin-top: 16px;
  color: #ba1a1a;
}
.success {
  margin-top: 16px;
  color: #0b7654;
}
</style>
