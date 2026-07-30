<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { transactionExplorerUrl } from '../contracts/addresses'
import {
  createReceivableOnchain,
  resumeReceivableTransaction,
  verifyReceivableOnchain,
} from '../services/web3/receivableContract'
import { useAuthStore } from '../stores/auth'
import { useReceivableStore } from '../stores/receivable'
import { useWalletStore } from '../stores/wallet'
import {
  formatBusinessNumber,
  normalizeBusinessNumber,
} from '../utils/businessNumber'

const PENDING_SYNC_STORAGE_KEY = 'receivablePendingBlockchainSync'
const router = useRouter()
const authStore = useAuthStore()
const receivableStore = useReceivableStore()
const walletStore = useWalletStore()
const errorMessage = ref('')
const successMessage = ref('')
const actionStage = ref('')
const lastTxHash = ref('')
const pendingSync = ref(null)
const isSubmitting = ref(false)
const isRefreshing = ref(false)
const isChainActionRunning = ref(false)
const showForm = ref(false)
const buyerAttestationAccepted = ref(false)
const form = reactive({
  buyerBusinessNumber: '',
  faceValue: '',
  fundingAmount: '',
  issueDate: new Date().toISOString().slice(0, 10),
  maturityDate: '',
  documentHash: '',
  description: '',
})

const selectedReceivable = computed(
  () => receivableStore.selectedReceivable,
)
const currentCompanyId = computed(() => authStore.user?.companyId)
const isSeller = computed(
  () =>
    selectedReceivable.value &&
    sameId(
      currentCompanyId.value,
      selectedReceivable.value.sellerCompanyId,
    ),
)
const isBuyer = computed(
  () =>
    selectedReceivable.value &&
    sameId(
      currentCompanyId.value,
      selectedReceivable.value.buyerCompanyId,
    ),
)
const buyerReviewRequired = computed(
  () =>
    Boolean(isBuyer.value) &&
    selectedReceivable.value.status === 'CREATED',
)
const hasCompleteChainMetadata = computed(
  () =>
    Boolean(
      selectedReceivable.value?.onchainReceivableId &&
        selectedReceivable.value?.contractAddress &&
        selectedReceivable.value?.createTxHash,
    ),
)
const canCreateOnchain = computed(
  () =>
    !pendingSync.value &&
    isSeller.value &&
    selectedReceivable.value.status === 'CREATED' &&
    !selectedReceivable.value.onchainReceivableId,
)
const canVerify = computed(
  () =>
    !pendingSync.value &&
    buyerReviewRequired.value &&
    hasCompleteChainMetadata.value,
)
const canSubmitVerification = computed(
  () =>
    canVerify.value &&
    buyerAttestationAccepted.value &&
    !isRefreshing.value &&
    !isChainActionRunning.value,
)
const buyerVerificationButtonText = computed(
  () => {
    if (isRefreshing.value) return '최신 상태 확인 중...'
    if (isChainActionRunning.value) return 'GIWA 확인 중...'
    if (pendingSync.value) return '기존 블록체인 작업 처리 중'
    if (!hasCompleteChainMetadata.value) {
      return 'Seller 온체인 생성 대기 중'
    }
    if (!buyerAttestationAccepted.value) {
      return '채권 내용 확인 후 동의해 주세요'
    }
    return '확인 내용을 MetaMask로 서명'
  },
)
const pendingSyncForSelected = computed(
  () =>
    pendingSync.value &&
    selectedReceivable.value &&
    sameId(
      pendingSync.value.receivableId,
      selectedReceivable.value.receivableId,
    ),
)

onMounted(loadPage)

async function loadPage() {
  clearMessages()
  buyerAttestationAccepted.value = false
  try {
    await Promise.all([
      authStore.loadUser(),
      walletStore.loadWallet(),
      receivableStore.loadAll(),
    ])
    pendingSync.value = readPendingSynchronization(
      currentCompanyId.value,
    )
    if (pendingSync.value) {
      await receivableStore.loadOne(pendingSync.value.receivableId)
      lastTxHash.value = pendingSync.value.payload.txHash
    } else if (receivableStore.receivables.length) {
      const initialReceivable =
        receivableStore.receivables.find(
          (receivable) =>
            isBuyerFor(receivable) &&
            receivable.status === 'CREATED' &&
            hasCompleteBlockchainMetadata(receivable),
        ) ??
        receivableStore.receivables.find(
          (receivable) =>
            isBuyerFor(receivable) &&
            receivable.status === 'CREATED',
        ) ??
        receivableStore.receivables[0]
      await receivableStore.loadOne(initialReceivable.receivableId)
    } else {
      receivableStore.clearSelection()
    }
  } catch (error) {
    errorMessage.value = error.message
  }
}

async function submit() {
  clearMessages()
  isSubmitting.value = true
  try {
    await receivableStore.create({
      ...form,
      buyerBusinessNumber: normalizeBusinessNumber(
        form.buyerBusinessNumber,
      ),
      documentHash: form.documentHash || null,
      description: form.description || null,
    })
    successMessage.value =
      'DB 등록이 완료되었습니다. 상세 화면에서 GIWA 온체인 생성을 진행해 주세요.'
    showForm.value = false
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    isSubmitting.value = false
  }
}

async function selectReceivable(receivableId) {
  clearMessages()
  buyerAttestationAccepted.value = false
  try {
    await receivableStore.loadOne(receivableId)
    if (pendingSyncForSelected.value) {
      lastTxHash.value = pendingSync.value.payload.txHash
    }
  } catch (error) {
    errorMessage.value = error.message
  }
}

async function selectPendingReceivable() {
  if (!pendingSync.value) return
  await selectReceivable(pendingSync.value.receivableId)
}

async function refreshSelectedReceivable() {
  const receivableId = selectedReceivable.value?.receivableId
  if (!receivableId) return

  clearMessages({ keepTransaction: Boolean(pendingSync.value) })
  buyerAttestationAccepted.value = false
  isRefreshing.value = true
  try {
    await Promise.all([
      receivableStore.loadAll(),
      receivableStore.loadOne(receivableId),
    ])
    successMessage.value = '채권의 최신 상태를 불러왔습니다.'
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    isRefreshing.value = false
  }
}

async function createOnchain() {
  const receivable = selectedReceivable.value
  if (!receivable) return

  clearMessages()
  isChainActionRunning.value = true
  actionStage.value =
    'MetaMask 서명 후 GIWA 블록 확인을 기다리고 있습니다...'
  try {
    const result = await createReceivableOnchain(
      receivable,
      (submitted) => {
        savePendingSynchronization({
          type: 'chain-created',
          phase: 'submitted',
          receivableId: receivable.receivableId,
          companyId: currentCompanyId.value,
          payload: submitted,
        })
        lastTxHash.value = submitted.txHash
      },
    )
    savePendingSynchronization({
      type: 'chain-created',
      phase: 'confirmed',
      receivableId: receivable.receivableId,
      companyId: currentCompanyId.value,
      payload: result,
    })
    lastTxHash.value = result.txHash
    await synchronizePending()
  } catch (error) {
    lastTxHash.value =
      error.txHash ?? pendingSync.value?.payload.txHash ?? ''
    clearTerminalPendingTransaction(error)
    errorMessage.value = error.message
    actionStage.value = ''
  } finally {
    isChainActionRunning.value = false
  }
}

async function verifyOnchain() {
  const receivable = selectedReceivable.value
  if (!receivable) return
  if (!canSubmitVerification.value) {
    errorMessage.value =
      '채권 내용을 확인하고 Buyer 검증 동의 항목을 선택해 주세요.'
    return
  }

  clearMessages()
  isChainActionRunning.value = true
  actionStage.value =
    'Buyer MetaMask 서명 후 GIWA 블록 확인을 기다리고 있습니다...'
  try {
    const result = await verifyReceivableOnchain(
      receivable,
      (submitted) => {
        savePendingSynchronization({
          type: 'verified',
          phase: 'submitted',
          receivableId: receivable.receivableId,
          companyId: currentCompanyId.value,
          payload: submitted,
        })
        lastTxHash.value = submitted.txHash
      },
    )
    savePendingSynchronization({
      type: 'verified',
      phase: 'confirmed',
      receivableId: receivable.receivableId,
      companyId: currentCompanyId.value,
      payload: result,
    })
    lastTxHash.value = result.txHash
    await synchronizePending()
  } catch (error) {
    lastTxHash.value =
      error.txHash ?? pendingSync.value?.payload.txHash ?? ''
    clearTerminalPendingTransaction(error)
    errorMessage.value = error.message
    actionStage.value = ''
  } finally {
    isChainActionRunning.value = false
  }
}

async function retryPendingSync() {
  if (!pendingSync.value) return
  clearMessages({ keepTransaction: true })
  isChainActionRunning.value = true
  try {
    if (pendingSync.value.phase === 'submitted') {
      await resumePendingConfirmation()
    } else {
      await synchronizePending()
    }
  } finally {
    isChainActionRunning.value = false
  }
}

async function resumePendingConfirmation() {
  const synchronization = pendingSync.value
  const receivable = selectedReceivable.value
  if (!synchronization || !receivable) return

  actionStage.value =
    '기존 GIWA 트랜잭션의 블록 확인을 이어받고 있습니다...'
  try {
    const result = await resumeReceivableTransaction(
      receivable,
      synchronization,
    )
    savePendingSynchronization({
      ...synchronization,
      phase: 'confirmed',
      payload: result,
    })
    lastTxHash.value = result.txHash
    await synchronizePending()
  } catch (error) {
    actionStage.value = ''
    lastTxHash.value =
      error.txHash ?? synchronization.payload.txHash
    clearTerminalPendingTransaction(error)
    errorMessage.value = error.message
  }
}

async function synchronizePending() {
  const synchronization = pendingSync.value
  if (!synchronization) return
  if (synchronization.phase !== 'confirmed') {
    await resumePendingConfirmation()
    return
  }

  actionStage.value =
    '온체인 트랜잭션 확인 완료 · 서버 상태를 동기화하고 있습니다...'
  try {
    if (synchronization.type === 'chain-created') {
      await receivableStore.markChainCreated(
        synchronization.receivableId,
        synchronization.payload,
      )
      successMessage.value =
        'GIWA 채권 생성과 서버 동기화가 완료되었습니다. Buyer 검증을 기다립니다.'
    } else {
      await receivableStore.markVerified(
        synchronization.receivableId,
        synchronization.payload,
      )
      successMessage.value =
        'Buyer 검증과 서버 동기화가 완료되었습니다. 다음 단계는 Seller 토큰화입니다.'
      buyerAttestationAccepted.value = false
    }
    clearPendingSynchronization()
    actionStage.value = ''
  } catch (error) {
    actionStage.value = ''
    errorMessage.value =
      `온체인 트랜잭션은 성공했지만 서버 동기화에 실패했습니다. ` +
      `컨트랙트를 다시 호출하지 말고 아래 버튼으로 재시도해 주세요. (${error.message})`
  }
}

function clearMessages({ keepTransaction = false } = {}) {
  errorMessage.value = ''
  successMessage.value = ''
  actionStage.value = ''
  if (!keepTransaction) lastTxHash.value = ''
}

function readPendingSynchronization(companyId) {
  try {
    const value = localStorage.getItem(PENDING_SYNC_STORAGE_KEY)
    if (!value || companyId == null) return null
    return JSON.parse(value)[String(companyId)] ?? null
  } catch {
    localStorage.removeItem(PENDING_SYNC_STORAGE_KEY)
    return null
  }
}

function savePendingSynchronization(synchronization) {
  pendingSync.value = synchronization
  let synchronizations
  try {
    synchronizations = JSON.parse(
      localStorage.getItem(PENDING_SYNC_STORAGE_KEY) ?? '{}',
    )
  } catch {
    synchronizations = {}
  }
  synchronizations[String(synchronization.companyId)] = synchronization
  localStorage.setItem(PENDING_SYNC_STORAGE_KEY, JSON.stringify(synchronizations))
}

function clearPendingSynchronization() {
  const companyId = pendingSync.value?.companyId ?? currentCompanyId.value
  pendingSync.value = null
  if (companyId == null) return

  try {
    const synchronizations = JSON.parse(
      localStorage.getItem(PENDING_SYNC_STORAGE_KEY) ?? '{}',
    )
    delete synchronizations[String(companyId)]
    if (Object.keys(synchronizations).length) {
      localStorage.setItem(
        PENDING_SYNC_STORAGE_KEY,
        JSON.stringify(synchronizations),
      )
    } else {
      localStorage.removeItem(PENDING_SYNC_STORAGE_KEY)
    }
  } catch {
    localStorage.removeItem(PENDING_SYNC_STORAGE_KEY)
  }
}

function clearTerminalPendingTransaction(error) {
  if (
    error.code === 'TRANSACTION_FAILED' ||
    error.code === 'TRANSACTION_CANCELLED'
  ) {
    clearPendingSynchronization()
  }
}

function sameId(first, second) {
  return first != null && second != null && String(first) === String(second)
}

function isBuyerFor(receivable) {
  return sameId(currentCompanyId.value, receivable.buyerCompanyId)
}

function counterpartyName(receivable) {
  return isBuyerFor(receivable)
    ? receivable.sellerCompanyName
    : receivable.buyerCompanyName
}

function counterpartyRole(receivable) {
  return isBuyerFor(receivable) ? 'Seller' : 'Buyer'
}

function receivableActionLabel(receivable) {
  if (isBuyerFor(receivable) && receivable.status === 'CREATED') {
    return hasCompleteBlockchainMetadata(receivable)
      ? 'Buyer 검증 필요'
      : 'Seller 온체인 생성 대기'
  }
  if (isBuyerFor(receivable) && receivable.status === 'VERIFIED') {
    return 'Buyer 검증 완료'
  }
  if (
    sameId(currentCompanyId.value, receivable.sellerCompanyId) &&
    receivable.status === 'CREATED'
  ) {
    return receivable.onchainReceivableId
      ? 'Buyer 검증 대기'
      : 'Seller 온체인 생성 필요'
  }
  return receivable.status
}

function hasCompleteBlockchainMetadata(receivable) {
  return Boolean(
    receivable.onchainReceivableId &&
      receivable.contractAddress &&
      receivable.createTxHash,
  )
}

function formatAmount(value) {
  if (value == null) return '-'
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function updateBuyerBusinessNumber(event) {
  form.buyerBusinessNumber = formatBusinessNumber(event.target.value)
}
</script>

<template>
  <main class="receivables-page">
    <header>
      <div>
        <p class="eyebrow">GIWA RECEIVABLE FINANCE</p>
        <h1>매출채권</h1>
      </div>
      <div class="header-actions">
        <button
          class="secondary"
          type="button"
          @click="router.push({ name: 'dashboard' })"
        >
          대시보드
        </button>
        <button type="button" @click="showForm = !showForm">
          {{ showForm ? '등록 취소' : '새 채권 등록' }}
        </button>
      </div>
    </header>

    <p v-if="errorMessage" class="message error" role="alert">
      {{ errorMessage }}
    </p>
    <p v-if="successMessage" class="message success" role="status">
      {{ successMessage }}
    </p>
    <p v-if="actionStage" class="message pending" aria-live="polite">
      {{ actionStage }}
    </p>
    <p v-if="lastTxHash" class="message transaction">
      트랜잭션: {{ lastTxHash }}
      <a
        v-if="transactionExplorerUrl(lastTxHash)"
        :href="transactionExplorerUrl(lastTxHash)"
        target="_blank"
        rel="noopener noreferrer"
      >
        Explorer에서 보기
      </a>
    </p>

    <section v-if="showForm" class="panel">
      <h2>매출채권 등록</h2>
      <form @submit.prevent="submit">
        <label>
          Buyer 사업자등록번호
          <input
            :value="form.buyerBusinessNumber"
            inputmode="numeric"
            minlength="12"
            maxlength="12"
            pattern="[0-9]{3}-[0-9]{2}-[0-9]{5}"
            title="사업자등록번호 숫자 10자리를 입력해 주세요."
            required
            @input="updateBuyerBusinessNumber"
          />
        </label>
        <div class="two-columns">
          <label>
            채권 금액 (KRW)
            <input
              v-model="form.faceValue"
              type="number"
              min="1"
              step="1"
              required
            />
          </label>
          <label>
            펀딩 요청 금액 (KRW)
            <input
              v-model="form.fundingAmount"
              type="number"
              min="1"
              step="1"
              required
            />
          </label>
          <label>
            발행일
            <input v-model="form.issueDate" type="date" required />
          </label>
          <label>
            만기일
            <input v-model="form.maturityDate" type="date" required />
          </label>
        </div>
        <label>
          문서 SHA-256 해시 (선택)
          <input
            v-model="form.documentHash"
            maxlength="66"
            placeholder="0x..."
          />
        </label>
        <label>
          설명 (선택)
          <textarea
            v-model="form.description"
            maxlength="1000"
            rows="3"
          ></textarea>
        </label>
        <button type="submit" :disabled="isSubmitting">
          {{ isSubmitting ? '등록 중...' : 'DB에 등록' }}
        </button>
      </form>
    </section>

    <div class="content-grid">
      <section class="panel">
        <h2>채권 목록</h2>
        <p v-if="!receivableStore.receivables.length" class="empty">
          등록되거나 배정된 채권이 없습니다.
        </p>
        <button
          v-for="item in receivableStore.receivables"
          :key="item.receivableId"
          class="receivable-row"
          :class="{
            selected: sameId(
              selectedReceivable?.receivableId,
              item.receivableId,
            ),
          }"
          type="button"
          :aria-pressed="
            sameId(selectedReceivable?.receivableId, item.receivableId)
          "
          @click="selectReceivable(item.receivableId)"
        >
          <span>
            <strong>
              #{{ item.receivableId }} · {{ counterpartyRole(item) }}
              {{ counterpartyName(item) }}
            </strong>
            <small>{{ item.issueDate }} → {{ item.maturityDate }}</small>
            <small class="action-hint">
              {{ receivableActionLabel(item) }}
            </small>
          </span>
          <span class="amount">
            {{ formatAmount(item.faceValue) }} {{ item.currencyCode }}
          </span>
          <span class="status">{{ item.status }}</span>
        </button>
      </section>

      <section class="panel details">
        <h2>상세 정보</h2>
        <template v-if="selectedReceivable">
          <dl>
            <dt>채권 번호</dt>
            <dd>#{{ selectedReceivable.receivableId }}</dd>
            <dt>Seller</dt>
            <dd>{{ selectedReceivable.sellerCompanyName }}</dd>
            <dt>Buyer</dt>
            <dd>{{ selectedReceivable.buyerCompanyName }}</dd>
            <dt>채권 금액</dt>
            <dd>{{ formatAmount(selectedReceivable.faceValue) }} KRW</dd>
            <dt>펀딩 요청</dt>
            <dd>{{ formatAmount(selectedReceivable.fundingAmount) }} KRW</dd>
            <dt>발행일</dt>
            <dd>{{ selectedReceivable.issueDate }}</dd>
            <dt>만기일</dt>
            <dd>{{ selectedReceivable.maturityDate }}</dd>
            <dt>Seller 지갑</dt>
            <dd>{{ selectedReceivable.sellerWalletAddress }}</dd>
            <dt>Buyer 지갑</dt>
            <dd>{{ selectedReceivable.buyerWalletAddress }}</dd>
            <dt>문서 해시</dt>
            <dd>{{ selectedReceivable.documentHash || '등록되지 않음' }}</dd>
            <dt>상태</dt>
            <dd>{{ selectedReceivable.status }}</dd>
            <dt>온체인 ID</dt>
            <dd>{{ selectedReceivable.onchainReceivableId || '-' }}</dd>
            <dt>컨트랙트</dt>
            <dd>{{ selectedReceivable.contractAddress || '-' }}</dd>
            <dt>생성 Tx</dt>
            <dd>{{ selectedReceivable.createTxHash || '-' }}</dd>
            <dt>검증 Tx</dt>
            <dd>{{ selectedReceivable.verifyTxHash || '-' }}</dd>
            <dt>설명</dt>
            <dd>{{ selectedReceivable.description || '-' }}</dd>
          </dl>

          <section
            v-if="buyerReviewRequired"
            class="review-card"
            aria-labelledby="buyer-review-title"
          >
            <div>
              <p class="review-eyebrow">BUYER REVIEW</p>
              <h3 id="buyer-review-title">채권 내용 확인 및 검증</h3>
            </div>
            <p>
              온체인은 실제 거래 사실을 자동으로 판단하지 않습니다. 위의 거래
              조건을 확인한 Buyer 회사의 지갑 서명이 채무 확인 증거로 기록됩니다.
            </p>
            <ul class="review-checklist">
              <li>Seller와 Buyer 회사 및 등록 지갑이 올바른지 확인</li>
              <li>채권 금액, 펀딩 요청 금액, 발행일과 만기일 확인</li>
              <li>설명과 문서 해시가 실제 거래 증빙과 일치하는지 확인</li>
            </ul>
            <p
              v-if="!hasCompleteChainMetadata"
              class="review-prerequisite"
              role="status"
            >
              지금 채권 내용을 검토할 수 있습니다. MetaMask 서명은 Seller가
              미검증 채권을 GIWA에 생성한 뒤 활성화됩니다.
            </p>
            <p v-else class="review-ready" role="status">
              Seller의 GIWA 생성이 완료되었습니다. 서명 직전에 화면 정보와
              온체인 CREATED 데이터를 다시 대조합니다.
            </p>
            <label class="attestation">
              <input
                v-model="buyerAttestationAccepted"
                type="checkbox"
                :disabled="isChainActionRunning || Boolean(pendingSync)"
              />
              <span>
                위 거래 조건과 증빙을 확인했으며, Buyer 회사로서 해당 채무
                내용을 확인합니다.
              </span>
            </label>
            <div class="review-actions">
              <button
                class="secondary"
                type="button"
                :disabled="isRefreshing || isChainActionRunning"
                @click="refreshSelectedReceivable"
              >
                {{ isRefreshing ? '불러오는 중...' : '상태 새로고침' }}
              </button>
              <button
                type="button"
                :disabled="!canSubmitVerification"
                @click="verifyOnchain"
              >
                {{ buyerVerificationButtonText }}
              </button>
            </div>
          </section>

          <div class="workflow-card">
            <strong>현재 단계</strong>
            <p
              v-if="
                pendingSyncForSelected &&
                pendingSync.phase === 'submitted'
              "
            >
              트랜잭션이 GIWA에 제출되었습니다. 새 트랜잭션을 보내지 말고 기존
              블록 확인을 이어받아 주세요.
            </p>
            <p v-else-if="pendingSyncForSelected">
              온체인 트랜잭션은 성공했습니다. 새 트랜잭션을 보내기 전에 서버
              동기화를 완료해 주세요.
            </p>
            <p v-else-if="pendingSync">
              채권 #{{ pendingSync.receivableId }}의 서버 동기화가 남아 있어 새
              블록체인 요청이 잠겨 있습니다.
            </p>
            <p v-else-if="canCreateOnchain">
              DB 등록이 끝났습니다. Seller 지갑으로 GIWA 채권을 생성해 주세요.
            </p>
            <p
              v-else-if="
                isBuyer &&
                selectedReceivable.status === 'CREATED' &&
                !hasCompleteChainMetadata
              "
            >
              Buyer 검토 대상입니다. Seller의 GIWA 온체인 생성을 기다리는
              동안 위 채권 내용을 먼저 확인할 수 있습니다.
            </p>
            <p v-else-if="canVerify">
              GIWA 채권이 생성되었습니다. Buyer 지갑으로 채무 내용을 검증해 주세요.
            </p>
            <p
              v-else-if="
                isSeller &&
                selectedReceivable.status === 'CREATED' &&
                selectedReceivable.onchainReceivableId
              "
            >
              온체인 생성 완료 · Buyer 검증을 기다리고 있습니다.
            </p>
            <p v-else-if="selectedReceivable.status === 'VERIFIED'">
              Buyer 검증 완료 · 다음 TODO인 Seller 토큰화 대상입니다.
            </p>
            <p v-else>
              현재 계정에서 실행할 생성·검증 작업이 없습니다.
            </p>

            <button
              v-if="pendingSync && !pendingSyncForSelected"
              type="button"
              @click="selectPendingReceivable"
            >
              미동기화 채권으로 이동
            </button>
            <button
              v-if="canCreateOnchain"
              type="button"
              :disabled="isChainActionRunning"
              @click="createOnchain"
            >
              {{
                isChainActionRunning
                  ? 'GIWA 확인 중...'
                  : 'Seller 지갑으로 GIWA 채권 생성'
              }}
            </button>
          </div>

          <div
            v-if="pendingSyncForSelected"
            class="sync-alert"
            role="alert"
          >
            <strong v-if="pendingSync.phase === 'submitted'">
              GIWA 제출 완료 · 블록 확인 필요
            </strong>
            <strong v-else>온체인 성공 · 서버 동기화 필요</strong>
            <p>{{ pendingSync.payload.txHash }}</p>
            <button
              type="button"
              :disabled="isChainActionRunning"
              @click="retryPendingSync"
            >
              {{
                pendingSync.phase === 'submitted'
                  ? '기존 트랜잭션 확인 이어받기'
                  : '서버 동기화 재시도'
              }}
            </button>
          </div>
        </template>
        <p v-else class="empty">목록에서 채권을 선택하세요.</p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.receivables-page {
  min-height: 100vh;
  padding: 32px;
}
header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: center;
  max-width: 1180px;
  margin: 0 auto 24px;
}
.eyebrow {
  color: #0b7654;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
h1 {
  color: #15352b;
  font-size: 32px;
  font-weight: 700;
}
h2 {
  margin-bottom: 18px;
  color: #15352b;
  font-size: 20px;
  font-weight: 700;
}
.header-actions {
  display: flex;
  gap: 10px;
}
.panel {
  max-width: 1180px;
  margin: 0 auto 20px;
  padding: 24px;
  border: 1px solid #dfe5e1;
  border-radius: 14px;
  background: white;
}
form,
label {
  display: grid;
  gap: 8px;
}
form {
  gap: 16px;
}
.two-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
label {
  color: #27463b;
  font-size: 14px;
  font-weight: 600;
}
input,
textarea {
  width: 100%;
  padding: 11px 12px;
  border: 1px solid #b8c7c0;
  border-radius: 8px;
  font: inherit;
  resize: vertical;
}
button {
  border: 0;
  border-radius: 8px;
  padding: 11px 16px;
  background: #0b7654;
  color: white;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.secondary {
  border: 1px solid #9eb2a8;
  background: white;
  color: #315548;
}
.message {
  max-width: 1180px;
  margin: 0 auto 16px;
  padding: 12px 16px;
  border-radius: 8px;
  overflow-wrap: anywhere;
}
.message a {
  margin-left: 8px;
}
.error {
  background: #fff0f0;
  color: #ba1a1a;
}
.success {
  background: #e8f7ef;
  color: #0b7654;
}
.pending,
.transaction {
  background: #eef5ff;
  color: #22558c;
}
.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr);
  gap: 20px;
  max-width: 1180px;
  margin: 0 auto;
}
.content-grid .panel {
  width: 100%;
  margin: 0;
}
.receivable-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 16px;
  align-items: center;
  width: 100%;
  margin-top: 10px;
  text-align: left;
  background: #f4f8f5;
  color: #15352b;
}
.receivable-row.selected {
  outline: 2px solid #0b7654;
  outline-offset: 1px;
  background: #eaf6ef;
}
.receivable-row span:first-child {
  display: grid;
}
.receivable-row small {
  color: #62736b;
}
.receivable-row .action-hint {
  margin-top: 4px;
  color: #0b7654;
  font-weight: 700;
}
.amount {
  font-variant-numeric: tabular-nums;
}
.status {
  padding: 4px 8px;
  border-radius: 999px;
  background: #dff2e8;
  color: #0b7654;
  font-size: 12px;
}
.empty {
  color: #788a82;
}
dl {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 12px;
}
dt {
  color: #788a82;
}
dd {
  color: #15352b;
  overflow-wrap: anywhere;
}
.review-card {
  display: grid;
  gap: 14px;
  margin-top: 22px;
  padding: 18px;
  border: 2px solid #0b7654;
  border-radius: 12px;
  background: #f2faf6;
}
.review-eyebrow {
  margin: 0 0 4px;
  color: #0b7654;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.review-card h3 {
  margin: 0;
  color: #15352b;
  font-size: 18px;
}
.review-card p {
  margin: 0;
  color: #315548;
  line-height: 1.55;
}
.review-checklist {
  display: grid;
  gap: 7px;
  margin: 0;
  padding-left: 20px;
  color: #27463b;
  font-size: 14px;
}
.review-card .review-prerequisite,
.review-card .review-ready {
  padding: 11px 12px;
  border-radius: 8px;
}
.review-card .review-prerequisite {
  background: #fff5df;
  color: #7b4b07;
}
.review-card .review-ready {
  background: #dff2e8;
  color: #0b6548;
}
.attestation {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px;
  border: 1px solid #b8cfc3;
  border-radius: 8px;
  background: white;
  line-height: 1.5;
}
.attestation input {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  padding: 0;
}
.review-actions {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
}
.review-actions button {
  width: 100%;
}
.workflow-card,
.sync-alert {
  display: grid;
  gap: 10px;
  margin-top: 22px;
  padding: 16px;
  border-radius: 10px;
}
.workflow-card {
  border: 1px solid #c9ddd3;
  background: #f4f9f6;
}
.workflow-card strong,
.workflow-card p {
  color: #27463b;
}
.sync-alert {
  border: 1px solid #e5b66f;
  background: #fff8e9;
}
.sync-alert strong,
.sync-alert p {
  color: #7b4b07;
  overflow-wrap: anywhere;
}
@media (max-width: 760px) {
  .receivables-page {
    padding: 20px;
  }
  header {
    align-items: flex-start;
    flex-direction: column;
  }
  .two-columns,
  .content-grid {
    grid-template-columns: 1fr;
  }
  .receivable-row {
    grid-template-columns: 1fr;
  }
  .review-actions {
    grid-template-columns: 1fr;
  }
}
</style>
