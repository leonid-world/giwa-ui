<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useWalletStore } from '../stores/wallet'

const router = useRouter()
const auth = useAuthStore()
const wallet = useWalletStore()

const isLoading = ref(true)
const isWalletLoading = ref(false)
const profileError = ref('')
const walletError = ref('')
const copyMessage = ref('')

const email = computed(() => auth.user?.email ?? '-')

onMounted(loadProfile)

async function loadProfile() {
  isLoading.value = true
  profileError.value = ''
  walletError.value = ''

  try {
    const user = await auth.loadUser()
    if (!user) {
      await logout()
      return
    }
  } catch (error) {
    if (error?.status === 401) {
      await logout()
      return
    }
    profileError.value = error?.message ?? '내 정보를 불러오지 못했습니다.'
  }

  if (!profileError.value) await loadWallet()
  isLoading.value = false
}

async function loadWallet() {
  walletError.value = ''
  isWalletLoading.value = true
  try {
    await wallet.loadWallet()
  } catch (error) {
    walletError.value = error?.message ?? '회사 지갑 정보를 불러오지 못했습니다.'
  } finally {
    isWalletLoading.value = false
  }
}

async function copyWalletAddress() {
  copyMessage.value = ''
  try {
    await navigator.clipboard.writeText(wallet.walletAddress)
    copyMessage.value = '지갑 주소를 복사했습니다.'
  } catch {
    copyMessage.value = '주소를 복사하지 못했습니다. 직접 선택해 복사해 주세요.'
  }
}

async function logout() {
  auth.logout()
  wallet.clear()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <main class="profile-page">
    <section class="profile-shell">
      <header class="profile-heading">
        <p class="eyebrow">GIWA RECEIVABLE FINANCE</p>
        <h1>내 정보</h1>
        <p>현재 로그인 계정과 이 회사에 연결된 지갑을 확인할 수 있습니다.</p>
      </header>

      <p v-if="isLoading" class="notice loading-state" role="status">
        내 정보를 불러오고 있습니다...
      </p>

      <div v-else-if="profileError" class="notice error" role="alert">
        <span>{{ profileError }}</span>
        <button type="button" @click="loadProfile">다시 시도</button>
      </div>

      <template v-else>
        <div class="information-grid">
          <article class="information-card">
            <div class="card-heading">
              <div>
                <span class="card-label">계정</span>
                <h2>로그인 정보</h2>
              </div>
              <span class="status connected">로그인됨</span>
            </div>
            <dl>
              <div>
                <dt>이메일</dt>
                <dd>{{ email }}</dd>
              </div>
            </dl>
          </article>

          <article class="information-card">
            <div class="card-heading">
              <div>
                <span class="card-label">회사 지갑</span>
                <h2>MetaMask 연결</h2>
              </div>
              <span class="status" :class="{ connected: wallet.isConnected && !isWalletLoading }">
                {{ isWalletLoading ? '확인 중' : wallet.isConnected ? '연결됨' : '미연결' }}
              </span>
            </div>

            <p v-if="isWalletLoading" class="empty-wallet loading-state" role="status">
              회사 지갑 정보를 불러오고 있습니다...
            </p>
            <div v-else-if="walletError" class="wallet-error" role="alert">
              <p>{{ walletError }}</p>
              <button class="text-button" type="button" @click="loadWallet">다시 조회</button>
            </div>
            <template v-else-if="wallet.isConnected">
              <dl>
                <div>
                  <dt>등록된 지갑 주소</dt>
                  <dd class="wallet-address">{{ wallet.walletAddress }}</dd>
                </div>
              </dl>
              <button class="copy-button" type="button" @click="copyWalletAddress">
                주소 복사
              </button>
              <p v-if="copyMessage" class="copy-message" role="status">{{ copyMessage }}</p>
            </template>
            <p v-else class="empty-wallet">
              연결된 회사 지갑이 없습니다. 대시보드에서 MetaMask 계정을 연결해 주세요.
            </p>
          </article>
        </div>

        <div class="profile-actions">
          <button type="button" @click="router.push({ name: 'dashboard' })">지갑 관리</button>
          <button class="secondary" type="button" @click="logout">로그아웃</button>
        </div>
      </template>
    </section>
  </main>
</template>

<style scoped>
.profile-page {
  display: grid;
  min-height: 100%;
  place-items: start center;
  padding: 48px 24px 56px;
}

.profile-shell {
  width: min(100%, 900px);
}

.profile-heading {
  margin-bottom: 26px;
}

.eyebrow {
  margin: 0;
  color: #0b7654;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.1em;
}

h1 {
  margin: 6px 0 4px;
  color: #15352b;
  font-size: clamp(30px, 5vw, 42px);
  font-weight: 750;
  line-height: 1.2;
  letter-spacing: -0.025em;
}

.profile-heading > p:last-child {
  margin: 0;
  color: #62736b;
}

.information-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.information-card {
  min-width: 0;
  border: 1px solid #dce5e0;
  border-radius: 16px;
  padding: 24px;
  background: #ffffff;
  box-shadow: 0 14px 36px rgba(24, 62, 48, 0.055);
}

.card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.card-label {
  color: #6b7c74;
  font-size: 12px;
  font-weight: 700;
}

h2 {
  margin: 2px 0 0;
  color: #15352b;
  font-size: 20px;
  font-weight: 750;
}

.status {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 5px 9px;
  background: #eef1ef;
  color: #68766f;
  font-size: 12px;
  font-weight: 750;
}

.status.connected {
  background: #e2f4eb;
  color: #0b7654;
}

dl {
  margin: 24px 0 0;
}

dl > div {
  display: grid;
  gap: 5px;
}

dt {
  color: #6b7c74;
  font-size: 13px;
}

dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: #15352b;
  font-size: 16px;
  font-weight: 650;
}

.wallet-address {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 14px;
}

button {
  min-height: 42px;
  border: 0;
  border-radius: 9px;
  padding: 10px 16px;
  background: #0b7654;
  color: white;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;
}

button:hover {
  background: #075f44;
}

button:focus-visible {
  outline: 3px solid rgba(11, 118, 84, 0.3);
  outline-offset: 2px;
}

button:disabled {
  cursor: wait;
  opacity: 0.6;
}

.copy-button {
  margin-top: 18px;
  border: 1px solid #a8bab1;
  background: #ffffff;
  color: #315548;
}

.copy-button:hover {
  background: #f1f7f4;
}

.copy-message,
.empty-wallet,
.wallet-error p {
  margin: 12px 0 0;
  color: #62736b;
  font-size: 14px;
}

.wallet-error p {
  color: #a32323;
}

.wallet-error .text-button {
  min-height: auto;
  margin-top: 8px;
  padding: 0;
  background: transparent;
  color: #0b7654;
}

.wallet-error .text-button:hover {
  background: transparent;
  color: #075f44;
  text-decoration: underline;
}

.notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border: 1px solid #dfe5e1;
  border-radius: 13px;
  padding: 18px;
  background: #ffffff;
  color: #52675e;
}

.notice button {
  flex: 0 0 auto;
}

.notice.error {
  border-color: #efb4b4;
  background: #fff4f4;
  color: #8f1717;
}

.profile-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 22px;
}

.profile-actions .secondary {
  border: 1px solid #a8bab1;
  background: #ffffff;
  color: #315548;
}

.profile-actions .secondary:hover {
  background: #f1f7f4;
}

@media (max-width: 680px) {
  .profile-page {
    padding: 36px 16px 44px;
  }

  .information-grid {
    grid-template-columns: 1fr;
  }

  .information-card {
    padding: 20px;
  }

  .profile-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
</style>
