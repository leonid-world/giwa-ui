<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { transactionExplorerUrl } from '../contracts/addresses'
import { getReceivableBlockchainTransactions } from '../services/blockchainTransactions'
import {
  approveFundingAmount,
  fundReceivableOnchain,
  getFundingReadiness,
  resumeReceivableTransaction,
} from '../services/web3/receivableContract'
import { useAuthStore } from '../stores/auth'
import { useReceivableStore } from '../stores/receivable'
import { useWalletStore } from '../stores/wallet'

const PENDING_SYNC_STORAGE_KEY = 'receivablePendingBlockchainSync'
const FUND_TRANSACTION_TYPE = 'FUND_RECEIVABLE'

const router = useRouter()
const authStore = useAuthStore()
const receivableStore = useReceivableStore()
const walletStore = useWalletStore()

const pendingSync = ref(null)
const readiness = ref(null)
const journalGate = ref('idle')
const journalMessage = ref('')
const errorMessage = ref('')
const successMessage = ref('')
const actionStage = ref('')
const lastTxHash = ref('')
const isLoading = ref(false)
const isActionRunning = ref(false)

const opportunities = computed(() => receivableStore.fundingOpportunities)
const selectedReceivable = computed(() => receivableStore.selectedReceivable)
const currentCompanyId = computed(() => authStore.user?.companyId)
const pendingForSelected = computed(
  () =>
    pendingSync.value &&
    selectedReceivable.value &&
    sameId(pendingSync.value.receivableId, selectedReceivable.value.receivableId),
)
const canApprove = computed(
  () =>
    !pendingSync.value &&
    journalGate.value === 'clear' &&
    readiness.value?.hasSufficientBalance &&
    !readiness.value?.hasSufficientAllowance &&
    !isActionRunning.value,
)
const canFund = computed(
  () =>
    !pendingSync.value &&
    journalGate.value === 'clear' &&
    readiness.value?.hasSufficientBalance &&
    readiness.value?.hasSufficientAllowance &&
    !isActionRunning.value,
)
const expectedReturn = computed(() => {
  const receivable = selectedReceivable.value
  if (!receivable) return null
  try {
    return (BigInt(receivable.faceValue) - BigInt(receivable.fundingAmount)).toString()
  } catch {
    return null
  }
})
const retryButtonLabel = computed(() => {
  if (pendingSync.value?.phase === 'submitted') {
    return '기존 펀딩 트랜잭션 확인'
  }
  return '서버 DB 동기화'
})

onMounted(loadPage)

async function loadPage() {
  clearMessages()
  isLoading.value = true
  try {
    await Promise.all([
      authStore.loadUser(),
      walletStore.loadWallet(),
      receivableStore.loadFundingOpportunities(),
    ])
    pendingSync.value = readPendingSynchronization(currentCompanyId.value)

    if (pendingSync.value?.type === 'funded') {
      await loadPendingReceivable()
      return
    }
    if (pendingSync.value) {
      throw new Error(
        '다른 채권 블록체인 작업이 남아 있습니다. 매출채권 관리 화면에서 먼저 처리해 주세요.',
      )
    }

    if (opportunities.value.length) {
      await selectOpportunity(opportunities.value[0].receivableId)
    } else {
      receivableStore.clearSelection()
      journalGate.value = 'clear'
    }
  } catch (error) {
    errorMessage.value = error.message ?? 'Funding 화면을 불러오지 못했습니다.'
  } finally {
    isLoading.value = false
  }
}

async function loadPendingReceivable() {
  const synchronization = pendingSync.value
  if (!synchronization) return
  await receivableStore.loadOne(synchronization.receivableId)
  lastTxHash.value = synchronization.payload?.txHash ?? ''

  const receivable = selectedReceivable.value
  if (
    receivable?.status === 'FUNDED' &&
    sameHex(receivable.fundingTxHash, synchronization.payload?.txHash)
  ) {
    clearPendingSynchronization()
    journalGate.value = 'clear'
    successMessage.value = '이미 서버에 반영된 Funder 자금 공급을 확인했습니다.'
    return
  }

  journalGate.value = 'adopted'
  journalMessage.value =
    synchronization.phase === 'confirmed'
      ? '온체인 펀딩은 성공했습니다. MetaMask를 다시 호출하지 않고 서버 DB 동기화만 진행해 주세요.'
      : '진행 중인 펀딩 트랜잭션이 있습니다. 새 트랜잭션을 보내지 말고 기존 블록 확인을 이어가 주세요.'
}

async function selectOpportunity(receivableId) {
  clearMessages()
  readiness.value = null
  journalGate.value = 'checking'
  journalMessage.value = '기존 펀딩 트랜잭션 이력을 확인하고 있습니다.'
  try {
    await receivableStore.loadOne(receivableId)
    const adopted = await inspectFundingJournal()
    if (!adopted) await refreshReadiness()
  } catch (error) {
    journalGate.value = 'error'
    errorMessage.value = error.message ?? '펀딩 대상 채권을 불러오지 못했습니다.'
  }
}

async function refreshPage() {
  const receivableId = selectedReceivable.value?.receivableId
  clearMessages({ keepTransaction: Boolean(pendingSync.value) })
  isLoading.value = true
  try {
    await receivableStore.loadFundingOpportunities()
    if (pendingSync.value?.type === 'funded') {
      await loadPendingReceivable()
      return
    }
    if (
      receivableId &&
      opportunities.value.some((item) => sameId(item.receivableId, receivableId))
    ) {
      await selectOpportunity(receivableId)
    } else if (opportunities.value.length) {
      await selectOpportunity(opportunities.value[0].receivableId)
    } else {
      receivableStore.clearSelection()
      readiness.value = null
      journalGate.value = 'clear'
    }
  } catch (error) {
    errorMessage.value = error.message ?? '최신 Funding 상태를 불러오지 못했습니다.'
  } finally {
    isLoading.value = false
  }
}

async function refreshReadiness() {
  const receivable = selectedReceivable.value
  if (!receivable || pendingSync.value) return
  if (!walletStore.walletAddress) {
    readiness.value = null
    throw new Error('Dashboard에서 Funder 회사 지갑을 먼저 연결해 주세요.')
  }

  actionStage.value = 'GIWA 채권, NFT 에스크로, mKRW 잔액과 승인 상태를 확인하고 있습니다...'
  try {
    readiness.value = await getFundingReadiness(receivable, walletStore.walletAddress)
    journalGate.value = 'clear'
    journalMessage.value = '새 펀딩을 시작해도 되는 상태임을 확인했습니다.'
  } finally {
    actionStage.value = ''
  }
}

async function approveMkrw() {
  const receivable = selectedReceivable.value
  if (!receivable || !canApprove.value) return

  clearMessages()
  isActionRunning.value = true
  actionStage.value = '1단계 · MetaMask에서 정확한 펀딩 금액의 mKRW 사용 승인을 확인해 주세요...'
  try {
    const result = await approveFundingAmount(receivable, walletStore.walletAddress)
    lastTxHash.value = result.txHash ?? ''
    await refreshReadiness()
    successMessage.value = result.alreadyApproved
      ? '이미 필요한 mKRW 사용 승인이 완료되어 있습니다. 2단계 자금 공급을 직접 진행해 주세요.'
      : 'mKRW 사용 승인이 확인되었습니다. 자동으로 펀딩하지 않으므로 내용을 다시 확인한 뒤 2단계 자금 공급 버튼을 눌러 주세요.'
  } catch (error) {
    lastTxHash.value = error.txHash ?? lastTxHash.value
    errorMessage.value = error.message ?? 'mKRW 사용 승인을 완료하지 못했습니다.'
  } finally {
    actionStage.value = ''
    isActionRunning.value = false
  }
}

async function startFunding() {
  const requestedReceivable = selectedReceivable.value
  if (!requestedReceivable || !canFund.value) return

  clearMessages()
  isActionRunning.value = true
  try {
    const adopted = await inspectFundingJournal()
    if (
      adopted ||
      pendingSync.value ||
      !sameId(selectedReceivable.value?.receivableId, requestedReceivable.receivableId)
    ) {
      return
    }
    await refreshReadiness()
    if (
      pendingSync.value ||
      journalGate.value !== 'clear' ||
      !readiness.value?.hasSufficientBalance ||
      !readiness.value?.hasSufficientAllowance
    ) {
      return
    }

    actionStage.value = '2단계 · MetaMask 서명 후 mKRW 지급과 NFT 이전 블록을 기다리고 있습니다...'
    const result = await fundReceivableOnchain(
      requestedReceivable,
      walletStore.walletAddress,
      (submitted) => {
        savePendingSynchronization({
          type: 'funded',
          phase: 'submitted',
          receivableId: requestedReceivable.receivableId,
          companyId: currentCompanyId.value,
          payload: submitted,
        })
        lastTxHash.value = submitted.txHash
      },
    )
    savePendingSynchronization({
      type: 'funded',
      phase: 'confirmed',
      journalConfirmed: true,
      receivableId: requestedReceivable.receivableId,
      companyId: currentCompanyId.value,
      payload: {
        ...pendingSync.value?.payload,
        ...result,
      },
    })
    lastTxHash.value = result.txHash
    await synchronizePending()
  } catch (error) {
    lastTxHash.value = error.txHash ?? pendingSync.value?.payload?.txHash ?? ''
    clearTerminalPendingTransaction(error)
    errorMessage.value = error.message ?? '채권 자금 공급을 완료하지 못했습니다.'
  } finally {
    actionStage.value = ''
    isActionRunning.value = false
  }
}

async function inspectFundingJournal() {
  const receivable = selectedReceivable.value
  if (!receivable || pendingSync.value) {
    return Boolean(pendingSync.value)
  }

  journalGate.value = 'checking'
  journalMessage.value =
    '서버의 기존 펀딩 이력을 확인하고 있습니다. 확인 전에는 새 자금 공급을 시작할 수 없습니다.'
  try {
    const transactions = await getReceivableBlockchainTransactions(receivable.receivableId)
    const fundingTransactions = transactions.filter(
      (transaction) => transaction?.transactionType === FUND_TRANSACTION_TYPE,
    )
    const confirmed = fundingTransactions.find(
      (transaction) => transaction?.txStatus === 'CONFIRMED',
    )
    const pending = fundingTransactions.find((transaction) => transaction?.txStatus === 'PENDING')
    const journal = confirmed ?? pending

    if (!journal) {
      const unknown = fundingTransactions.some((transaction) => transaction?.txStatus !== 'FAILED')
      if (unknown) {
        journalGate.value = 'blocked'
        journalMessage.value =
          '상태를 판별할 수 없는 기존 펀딩 이력이 있어 새 트랜잭션을 차단했습니다.'
        return true
      }
      journalGate.value = 'clear'
      journalMessage.value = '진행 중이거나 성공한 기존 펀딩 트랜잭션이 없습니다.'
      return false
    }
    if (!isValidFundingJournal(journal, receivable)) {
      journalGate.value = 'blocked'
      journalMessage.value =
        '기존 펀딩 이력의 회사·지갑·컨트랙트 정보가 현재 로그인 정보와 일치하지 않아 새 트랜잭션을 차단했습니다.'
      return true
    }

    savePendingSynchronization({
      type: 'funded',
      phase: journal.txStatus === 'CONFIRMED' ? 'confirmed' : 'submitted',
      journalConfirmed: journal.txStatus === 'CONFIRMED',
      recoveredFromServerJournal: true,
      receivableId: receivable.receivableId,
      companyId: currentCompanyId.value,
      payload: {
        txHash: journal.txHash,
        contractAddress: journal.contractAddress,
        funderWalletAddress: journal.walletAddress,
      },
    })
    lastTxHash.value = journal.txHash
    journalGate.value = 'adopted'
    journalMessage.value =
      journal.txStatus === 'CONFIRMED'
        ? '이미 성공한 펀딩을 찾았습니다. MetaMask를 다시 호출하지 말고 서버 DB 동기화만 진행해 주세요.'
        : '이미 진행 중인 펀딩을 찾았습니다. 새 트랜잭션을 보내지 말고 기존 블록 확인을 이어가 주세요.'
    return true
  } catch (error) {
    journalGate.value = 'error'
    journalMessage.value = `기존 펀딩 이력을 확인하지 못해 새 트랜잭션을 차단했습니다. (${error.message})`
    return true
  }
}

async function retryPending() {
  if (!pendingSync.value) return
  clearMessages({ keepTransaction: true })
  isActionRunning.value = true
  try {
    if (pendingSync.value.phase === 'submitted') {
      await resumePendingConfirmation()
    } else {
      await synchronizePending()
    }
  } finally {
    isActionRunning.value = false
  }
}

async function resumePendingConfirmation() {
  const synchronization = pendingSync.value
  const receivable = selectedReceivable.value
  if (!synchronization || !receivable) return

  actionStage.value = '기존 GIWA 펀딩 트랜잭션의 블록 확인을 이어받고 있습니다...'
  try {
    const result = await resumeReceivableTransaction(receivable, synchronization, (submitted) => {
      savePendingSynchronization({
        ...synchronization,
        payload: {
          ...synchronization.payload,
          ...submitted,
        },
      })
      lastTxHash.value = submitted.txHash
    })
    savePendingSynchronization({
      ...synchronization,
      phase: 'confirmed',
      journalConfirmed: true,
      payload: {
        ...synchronization.payload,
        ...result,
      },
    })
    lastTxHash.value = result.txHash
    await synchronizePending()
  } catch (error) {
    lastTxHash.value = error.txHash ?? synchronization.payload?.txHash ?? ''
    clearTerminalPendingTransaction(error)
    errorMessage.value = error.message ?? '기존 펀딩 트랜잭션을 확인하지 못했습니다.'
  } finally {
    actionStage.value = ''
  }
}

async function synchronizePending() {
  const synchronization = pendingSync.value
  if (!synchronization) return
  if (synchronization.phase !== 'confirmed') {
    await resumePendingConfirmation()
    return
  }

  actionStage.value = '온체인 펀딩 확인 완료 · 서버 상태를 FUNDED로 동기화하고 있습니다...'
  try {
    const funded = await receivableStore.markFunded(synchronization.receivableId, {
      txHash: synchronization.payload.txHash,
    })
    clearPendingSynchronization()
    journalGate.value = 'clear'
    readiness.value = null
    lastTxHash.value = funded.fundingTxHash
    successMessage.value =
      '자금 공급이 완료되었습니다. Seller에게 mKRW가 지급되고 채권 NFT가 Funder 지갑으로 이전되었습니다.'
  } catch (error) {
    clearTerminalPendingTransaction(error)
    errorMessage.value = `${error.message} 온체인 트랜잭션을 다시 보내지 말고 서버 DB 동기화를 재시도해 주세요.`
  } finally {
    actionStage.value = ''
  }
}

function isValidFundingJournal(journal, receivable) {
  return (
    sameId(journal?.receivableId, receivable.receivableId) &&
    sameId(journal?.companyId, currentCompanyId.value) &&
    sameHex(journal?.walletAddress, walletStore.walletAddress) &&
    sameHex(journal?.contractAddress, receivable.contractAddress) &&
    journal?.functionName === 'fundReceivable' &&
    /^0x[a-fA-F0-9]{64}$/.test(journal?.txHash ?? '')
  )
}

function readPendingSynchronization(companyId) {
  if (companyId == null) return null
  try {
    const synchronizations = JSON.parse(localStorage.getItem(PENDING_SYNC_STORAGE_KEY) ?? '{}')
    return synchronizations[String(companyId)] ?? null
  } catch {
    localStorage.removeItem(PENDING_SYNC_STORAGE_KEY)
    return null
  }
}

function savePendingSynchronization(synchronization) {
  const companyId = synchronization.companyId ?? currentCompanyId.value
  if (companyId == null) return
  let synchronizations
  try {
    synchronizations = JSON.parse(localStorage.getItem(PENDING_SYNC_STORAGE_KEY) ?? '{}')
  } catch {
    synchronizations = {}
  }
  const saved = { ...synchronization, companyId }
  synchronizations[String(companyId)] = saved
  localStorage.setItem(PENDING_SYNC_STORAGE_KEY, JSON.stringify(synchronizations))
  pendingSync.value = saved
}

function clearPendingSynchronization() {
  const companyId = pendingSync.value?.companyId ?? currentCompanyId.value
  try {
    const synchronizations = JSON.parse(localStorage.getItem(PENDING_SYNC_STORAGE_KEY) ?? '{}')
    if (companyId != null) {
      delete synchronizations[String(companyId)]
    }
    if (Object.keys(synchronizations).length) {
      localStorage.setItem(PENDING_SYNC_STORAGE_KEY, JSON.stringify(synchronizations))
    } else {
      localStorage.removeItem(PENDING_SYNC_STORAGE_KEY)
    }
  } catch {
    localStorage.removeItem(PENDING_SYNC_STORAGE_KEY)
  }
  pendingSync.value = null
}

function clearTerminalPendingTransaction(error) {
  const terminalCodes = new Set([
    'TRANSACTION_FAILED',
    'TRANSACTION_CANCELLED',
    'BLOCKCHAIN_TRANSACTION_FAILED',
    'BLOCKCHAIN_TRANSACTION_REVERTED',
    'BLOCKCHAIN_TRANSACTION_VERIFICATION_FAILED',
    'BLOCKCHAIN_EVENT_MISMATCH',
  ])
  if (!terminalCodes.has(error?.code)) return false
  clearPendingSynchronization()
  journalGate.value = 'clear'
  return true
}

function clearMessages({ keepTransaction = false } = {}) {
  errorMessage.value = ''
  successMessage.value = ''
  actionStage.value = ''
  if (!keepTransaction) lastTxHash.value = ''
}

function sameId(first, second) {
  return first != null && second != null && String(first) === String(second)
}

function sameHex(first, second) {
  return (
    typeof first === 'string' &&
    typeof second === 'string' &&
    first.toLowerCase() === second.toLowerCase()
  )
}

function formatAmount(value) {
  if (value == null || value === '') return '-'
  try {
    return `${BigInt(value).toLocaleString('ko-KR')} KRW`
  } catch {
    return `${value} KRW`
  }
}

function shortAddress(value) {
  if (!value) return '-'
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}
</script>

<template>
  <main class="funding-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">GIWA FUNDING MARKET</p>
        <h1>토큰화 채권 펀딩</h1>
        <p>Seller와 Buyer가 아닌 제3자 회사가 mKRW를 공급하고 에스크로된 채권 NFT를 인수합니다.</p>
      </div>
      <nav>
        <button type="button" class="secondary" @click="router.push({ name: 'dashboard' })">
          Dashboard
        </button>
        <button type="button" class="secondary" @click="router.push({ name: 'receivables' })">
          매출채권 관리
        </button>
        <button type="button" :disabled="isLoading" @click="refreshPage">
          {{ isLoading ? '조회 중...' : '최신 상태 조회' }}
        </button>
      </nav>
    </header>

    <p v-if="errorMessage" class="notice error" role="alert">
      {{ errorMessage }}
    </p>
    <p v-if="successMessage" class="notice success" role="status">
      {{ successMessage }}
    </p>
    <p v-if="actionStage" class="notice progress" role="status">
      {{ actionStage }}
    </p>

    <section class="workspace">
      <aside class="opportunity-panel">
        <h2>펀딩 가능 채권</h2>
        <p v-if="!opportunities.length" class="empty">
          현재 펀딩 가능한 TOKENIZED 채권이 없습니다.
        </p>
        <button
          v-for="receivable in opportunities"
          :key="receivable.receivableId"
          type="button"
          class="opportunity-card"
          :class="{
            selected: sameId(receivable.receivableId, selectedReceivable?.receivableId),
          }"
          @click="selectOpportunity(receivable.receivableId)"
        >
          <span>#{{ receivable.receivableId }} · NFT #{{ receivable.tokenId }}</span>
          <strong> {{ receivable.sellerCompanyName }} → {{ receivable.buyerCompanyName }} </strong>
          <span>필요 자금 {{ formatAmount(receivable.fundingAmount) }}</span>
          <small>만기 {{ receivable.maturityDate }}</small>
        </button>
      </aside>

      <article v-if="selectedReceivable" class="detail-panel">
        <div class="detail-heading">
          <div>
            <span class="status">{{ selectedReceivable.status }}</span>
            <h2>채권 #{{ selectedReceivable.receivableId }}</h2>
          </div>
          <span class="wallet-label">
            Funder 지갑 {{ shortAddress(walletStore.walletAddress) }}
          </span>
        </div>

        <dl class="terms">
          <div>
            <dt>Seller</dt>
            <dd>{{ selectedReceivable.sellerCompanyName }}</dd>
          </div>
          <div>
            <dt>Buyer</dt>
            <dd>{{ selectedReceivable.buyerCompanyName }}</dd>
          </div>
          <div>
            <dt>채권 금액</dt>
            <dd>{{ formatAmount(selectedReceivable.faceValue) }}</dd>
          </div>
          <div>
            <dt>공급할 금액</dt>
            <dd>{{ formatAmount(selectedReceivable.fundingAmount) }}</dd>
          </div>
          <div>
            <dt>예상 차액</dt>
            <dd>{{ formatAmount(expectedReturn) }}</dd>
          </div>
          <div>
            <dt>만기일</dt>
            <dd>{{ selectedReceivable.maturityDate }}</dd>
          </div>
          <div>
            <dt>NFT</dt>
            <dd>#{{ selectedReceivable.tokenId }}</dd>
          </div>
          <div>
            <dt>문서 해시</dt>
            <dd class="hash">{{ selectedReceivable.documentHash || '등록되지 않음' }}</dd>
          </div>
        </dl>

        <section v-if="selectedReceivable.status === 'FUNDED'" class="completed-card" role="status">
          <h3>Funding 완료</h3>
          <p>
            {{ selectedReceivable.funderCompanyName || 'Funder' }}의 자금 공급이 서버에
            반영되었습니다. NFT 소유권과 mKRW 지급은 온체인 트랜잭션으로 검증되었습니다.
          </p>
        </section>

        <section v-else-if="pendingForSelected" class="recovery-card" role="alert">
          <h3>기존 펀딩 작업을 먼저 완료해 주세요</h3>
          <p>{{ journalMessage }}</p>
          <button type="button" :disabled="isActionRunning" @click="retryPending">
            {{ isActionRunning ? '처리 중...' : retryButtonLabel }}
          </button>
        </section>

        <section v-else class="funding-steps">
          <div
            v-if="journalGate !== 'clear'"
            class="journal-gate"
            :class="{ blocked: journalGate === 'blocked' || journalGate === 'error' }"
          >
            <strong>기존 트랜잭션 안전 점검</strong>
            <p>{{ journalMessage }}</p>
            <button
              v-if="journalGate === 'error'"
              type="button"
              class="secondary"
              @click="selectOpportunity(selectedReceivable.receivableId)"
            >
              이력 다시 조회
            </button>
          </div>

          <template v-if="readiness">
            <div class="balance-grid">
              <div>
                <span>필요 mKRW</span>
                <strong>{{ formatAmount(readiness.fundingAmount) }}</strong>
              </div>
              <div>
                <span>내 mKRW 잔액</span>
                <strong>{{ formatAmount(readiness.balance) }}</strong>
              </div>
              <div>
                <span>현재 승인액</span>
                <strong>{{ formatAmount(readiness.allowance) }}</strong>
              </div>
            </div>

            <p v-if="!readiness.hasSufficientBalance" class="insufficient" role="alert">
              mKRW 잔액이 부족합니다. MockKRW 배포자(owner)가 현재 Funder 지갑에 최소 필요 금액을
              mint한 뒤 최신 상태를 조회해 주세요.
            </p>

            <div class="step-card" :class="{ complete: readiness.hasSufficientAllowance }">
              <span>1단계</span>
              <h3>mKRW 사용 승인</h3>
              <p>
                ReceivableFinance가 정확히
                {{ formatAmount(readiness.fundingAmount) }}를 사용할 수 있도록 승인합니다.
              </p>
              <button type="button" :disabled="!canApprove" @click="approveMkrw">
                {{ readiness.hasSufficientAllowance ? '승인 완료' : 'MetaMask로 mKRW 사용 승인' }}
              </button>
            </div>

            <div class="step-card" :class="{ enabled: canFund }">
              <span>2단계</span>
              <h3>채권 자금 공급</h3>
              <p>
                이 트랜잭션은 Seller에게 mKRW를 지급하고 NFT를 Funder 지갑으로 이전합니다. 승인
                후에도 자동 실행되지 않습니다.
              </p>
              <button type="button" :disabled="!canFund" @click="startFunding">
                MetaMask로 자금 공급
              </button>
            </div>
          </template>
        </section>

        <a
          v-if="transactionExplorerUrl(lastTxHash)"
          class="explorer-link"
          :href="transactionExplorerUrl(lastTxHash)"
          target="_blank"
          rel="noopener noreferrer"
        >
          Explorer에서 트랜잭션 확인
        </a>
      </article>

      <article v-else class="detail-panel empty-detail">
        <h2>펀딩 대상 없음</h2>
        <p>
          Seller의 Buyer 검증과 NFT 민팅이 완료된 TOKENIZED 채권이 등록되면 이 화면에 표시됩니다.
        </p>
      </article>
    </section>
  </main>
</template>

<style scoped>
.funding-page {
  min-height: 100vh;
  padding: 32px;
  background: #f5f8f6;
  color: #15352b;
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  max-width: 1280px;
  margin: 0 auto 24px;
  gap: 24px;
}
.eyebrow {
  margin: 0;
  color: #0b7654;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.1em;
}
h1 {
  margin: 6px 0;
  font-size: 32px;
}
h2,
h3,
p {
  margin-top: 0;
}
.page-header p {
  color: #62736b;
}
nav {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
button {
  border: 0;
  border-radius: 8px;
  padding: 11px 14px;
  background: #0b7654;
  color: white;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}
button.secondary {
  border: 1px solid #bdcbc4;
  background: white;
  color: #315548;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.notice {
  max-width: 1280px;
  margin: 0 auto 14px;
  padding: 13px 16px;
  border-radius: 10px;
}
.notice.error {
  border: 1px solid #efb4b4;
  background: #fff2f2;
  color: #941f1f;
}
.notice.success {
  border: 1px solid #a8d6c4;
  background: #edfaf4;
  color: #086245;
}
.notice.progress {
  border: 1px solid #b8d4c8;
  background: #eff7f3;
  color: #315548;
}
.workspace {
  display: grid;
  grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
  max-width: 1280px;
  min-height: 620px;
  margin: 0 auto;
  gap: 18px;
}
.opportunity-panel,
.detail-panel {
  border: 1px solid #dfe5e1;
  border-radius: 16px;
  background: white;
  padding: 24px;
}
.opportunity-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.opportunity-card {
  display: grid;
  width: 100%;
  margin: 0;
  gap: 5px;
  border: 1px solid #dfe5e1;
  background: white;
  color: #315548;
  text-align: left;
}
.opportunity-card.selected {
  border-color: #0b7654;
  background: #eaf6f0;
}
.opportunity-card strong {
  color: #15352b;
}
.opportunity-card small {
  color: #6a7c74;
}
.empty {
  color: #77877f;
}
.detail-panel {
  min-width: 0;
}
.detail-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}
.detail-heading h2 {
  margin: 6px 0 0;
}
.status {
  display: inline-block;
  border-radius: 999px;
  padding: 4px 9px;
  background: #ddf3e8;
  color: #08714f;
  font-size: 12px;
  font-weight: 800;
}
.wallet-label {
  border-radius: 999px;
  padding: 7px 10px;
  background: #f1f5f3;
  color: #52675e;
  font-size: 13px;
}
.terms {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 24px;
  margin: 0 0 24px;
}
.terms div {
  min-width: 0;
  border-bottom: 1px solid #edf1ee;
  padding: 9px 0;
}
.terms dt {
  color: #77877f;
  font-size: 13px;
}
.terms dd {
  margin: 5px 0 0;
  font-weight: 700;
}
.hash {
  overflow-wrap: anywhere;
}
.funding-steps,
.recovery-card {
  display: grid;
  gap: 14px;
}
.balance-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.balance-grid div {
  display: grid;
  gap: 6px;
  border-radius: 10px;
  padding: 14px;
  background: #f4f8f5;
}
.balance-grid span,
.step-card > span {
  color: #62736b;
  font-size: 12px;
  font-weight: 800;
}
.step-card,
.journal-gate,
.recovery-card,
.completed-card {
  border: 1px solid #d9e3de;
  border-radius: 12px;
  padding: 18px;
}
.step-card.complete {
  border-color: #91cdb5;
  background: #effaf5;
}
.step-card.enabled {
  border-color: #0b7654;
}
.step-card button,
.journal-gate button,
.recovery-card button {
  margin-top: 8px;
}
.step-card p,
.journal-gate p,
.recovery-card p {
  color: #62736b;
}
.journal-gate {
  background: #f4f8f5;
}
.journal-gate.blocked {
  border-color: #efb4b4;
  background: #fff4f4;
}
.recovery-card {
  border-color: #d5c27a;
  background: #fffbea;
}
.completed-card {
  border-color: #91cdb5;
  background: #effaf5;
}
.completed-card p {
  margin-bottom: 0;
  color: #315548;
}
.insufficient {
  border-radius: 8px;
  padding: 12px;
  background: #fff2f2;
  color: #941f1f;
}
.explorer-link {
  display: inline-block;
  margin-top: 18px;
  color: #0b7654;
  font-weight: 700;
}
.empty-detail {
  display: grid;
  align-content: center;
  justify-items: center;
  color: #62736b;
  text-align: center;
}
@media (max-width: 900px) {
  .funding-page {
    padding: 20px;
  }
  .page-header {
    flex-direction: column;
  }
  nav {
    justify-content: flex-start;
  }
  .workspace {
    grid-template-columns: 1fr;
  }
  .terms,
  .balance-grid {
    grid-template-columns: 1fr;
  }
}
</style>
