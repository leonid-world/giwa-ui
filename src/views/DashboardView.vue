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
const isWalletLoading = ref(true)
const walletLoadFailed = ref(false)

onMounted(loadWalletState)

async function loadWalletState() {
  errorMessage.value = ''
  errorCode.value = ''
  isWalletLoading.value = true
  walletLoadFailed.value = false
  try {
    await wallet.loadWallet()
  } catch (error) {
    walletLoadFailed.value = true
    showError(error)
  } finally {
    isWalletLoading.value = false
  }
}

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
      <p class="description">회사 지갑을 MetaMask와 연결하세요. 개인 키는 저장되지 않습니다.</p>
      <div class="wallet-card">
        <span>현재 회사 지갑</span>
        <strong v-if="isWalletLoading" class="loading-state" role="status">
          회사 지갑 확인 중...
        </strong>
        <strong v-else-if="wallet.isConnected" class="wallet-address">
          {{ wallet.walletAddress }}
        </strong>
        <strong v-else-if="walletLoadFailed">지갑 상태 확인 실패</strong>
        <strong v-else>연결된 지갑 없음</strong>

        <button
          v-if="!wallet.hasPendingWallet"
          type="button"
          :disabled="isSelecting || isWalletLoading || walletLoadFailed"
          @click="selectWalletAccount"
        >
          {{
            isSelecting
              ? 'MetaMask 확인 중...'
              : wallet.isConnected
                ? '다른 계정 선택'
                : 'MetaMask 계정 선택'
          }}
        </button>

        <div
          v-if="wallet.hasPendingWallet && errorCode !== 'WALLET_ALREADY_MAPPED'"
          class="wallet-confirmation"
        >
          <span>선택한 MetaMask 계정</span>
          <strong class="wallet-address">{{ wallet.pendingWalletAddress }}</strong>
          <p>이 주소를 회사 지갑으로 연결하시겠습니까?</p>
          <div class="confirmation-actions">
            <button type="button" :disabled="isConnecting" @click="confirmWalletConnection">
              {{ isConnecting ? '연결 중...' : '이 지갑 연결' }}
            </button>
            <button
              class="secondary"
              type="button"
              :disabled="isSelecting"
              @click="selectWalletAccount"
            >
              다른 계정 선택
            </button>
            <button class="text-button" type="button" @click="cancelWalletSelection">취소</button>
          </div>
        </div>
      </div>

      <div v-if="errorCode === 'WALLET_ALREADY_MAPPED'" class="conflict-alert" role="alert">
        <strong>이미 등록된 MetaMask 지갑입니다.</strong>
        <p>{{ wallet.pendingWalletAddress }}</p>
        <p>
          이 주소는 다른 회사에서 사용 중입니다. 해당 회사용으로 분리된 MetaMask 계정을 선택해
          주세요.
        </p>
        <div class="confirmation-actions">
          <button type="button" :disabled="isSelecting" @click="selectWalletAccount">
            {{ isSelecting ? 'MetaMask 확인 중...' : '다른 계정 선택' }}
          </button>
          <button class="text-button danger" type="button" @click="cancelWalletSelection">
            닫기
          </button>
        </div>
      </div>
      <div v-else-if="errorMessage" class="error" role="alert">
        <span>{{ errorMessage }}</span>
        <button
          v-if="walletLoadFailed"
          class="text-button"
          type="button"
          :disabled="isWalletLoading"
          @click="loadWalletState"
        >
          {{ isWalletLoading ? '조회 중...' : '지갑 상태 다시 조회' }}
        </button>
      </div>
      <p v-if="successMessage" class="success" role="status">{{ successMessage }}</p>
      <div class="service-actions">
        <button
          type="button"
          :disabled="!wallet.isConnected || isWalletLoading"
          @click="router.push({ name: 'receivables' })"
        >
          매출채권 관리
        </button>
        <button
          type="button"
          :disabled="!wallet.isConnected || isWalletLoading"
          @click="router.push({ name: 'funding' })"
        >
          토큰화 채권 펀딩
        </button>
        <button
          type="button"
          :disabled="!wallet.isConnected || isWalletLoading"
          @click="router.push({ name: 'repayment' })"
        >
          매출채권 상환
        </button>
      </div>
      <button class="logout-button" type="button" @click="logout">로그아웃</button>
    </section>
  </main>
</template>

<style scoped>
.dashboard {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 48px 24px;
}

section {
  width: min(100%, 580px);
  padding: 40px;
  border: 1px solid #dce5e0;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 18px 48px rgba(24, 62, 48, 0.08);
}

.eyebrow {
  margin: 0;
  color: #0b7654;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.09em;
}

h1 {
  margin: 8px 0 6px;
  color: #15352b;
  font-size: 30px;
  font-weight: 750;
  line-height: 1.25;
  letter-spacing: -0.02em;
}

.description {
  margin: 0;
  color: #62736b;
  line-height: 1.6;
}

.wallet-card {
  display: grid;
  gap: 8px;
  margin-top: 24px;
  padding: 20px;
  border: 1px solid #dfe5e1;
  border-radius: 13px;
  background: #fbfdfc;
}

.wallet-card span {
  color: #62736b;
  font-size: 14px;
}

.wallet-card strong {
  overflow-wrap: anywhere;
  color: #15352b;
}

.wallet-address {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 14px;
  line-height: 1.55;
}

button {
  min-height: 44px;
  margin-top: 24px;
  border: 0;
  border-radius: 9px;
  padding: 11px 16px;
  background: #0b7654;
  color: white;
  cursor: pointer;
  font-weight: 700;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;
}

button:hover:not(:disabled) {
  background: #075f44;
}

button:focus-visible {
  outline: 3px solid rgba(11, 118, 84, 0.28);
  outline-offset: 2px;
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

.wallet-confirmation p {
  margin: 0;
  color: #52675e;
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
  background: #ffffff;
  color: #315548;
}

.secondary:hover:not(:disabled) {
  border-color: #759889;
  background: #f1f7f4;
}

.text-button {
  background: transparent;
  color: #52675e;
}

.text-button:hover:not(:disabled) {
  background: #edf3f0;
  color: #27463b;
}

.conflict-alert {
  margin-top: 16px;
  padding: 18px;
  border: 1px solid #efb4b4;
  border-radius: 11px;
  background: #fff4f4;
}

.conflict-alert strong,
.conflict-alert p {
  color: #8f1717;
}

.conflict-alert p {
  margin: 8px 0 0;
  line-height: 1.55;
}

.danger {
  color: #8f1717;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.error {
  display: grid;
  gap: 8px;
  margin-top: 16px;
  padding: 12px 14px;
  border: 1px solid #efc0c0;
  border-radius: 9px;
  background: #fff5f5;
  color: #a32323;
}

.error .text-button {
  justify-self: start;
  min-height: auto;
  margin-top: 0;
  padding: 0;
  color: #8f1717;
}

.error .text-button:hover:not(:disabled) {
  background: transparent;
  color: #6f1010;
  text-decoration: underline;
}

.success {
  margin-top: 16px;
  padding: 12px 14px;
  border: 1px solid #afd8c7;
  border-radius: 9px;
  background: #eef9f4;
  color: #086245;
}

.service-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.service-actions button {
  flex: 1 1 180px;
  margin-top: 0;
  border: 1px solid #a9cdbd;
  background: #edf7f2;
  color: #0b6548;
}

.service-actions button:hover:not(:disabled) {
  border-color: #78ad96;
  background: #e2f2ea;
}

.logout-button {
  width: 100%;
  margin-top: 12px;
  border: 1px solid #d1dcd6;
  background: #ffffff;
  color: #62736b;
}

.logout-button:hover:not(:disabled) {
  border-color: #aebfb7;
  background: #f4f7f5;
  color: #315548;
}

@media (max-width: 600px) {
  .dashboard {
    padding: 32px 16px;
  }

  section {
    padding: 30px 22px;
  }

  .confirmation-actions {
    display: grid;
  }

  .service-actions {
    display: grid;
  }
}
</style>
