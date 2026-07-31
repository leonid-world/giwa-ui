<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { addressExplorerUrl, transactionExplorerUrl } from '../contracts/addresses'
import {
  createReceivableOnchain,
  resumeReceivableTransaction,
  tokenizeReceivableOnchain,
  verifyReceivableOnchain,
} from '../services/web3/receivableContract'
import { getReceivableBlockchainTransactions } from '../services/blockchainTransactions'
import { useAuthStore } from '../stores/auth'
import { useReceivableStore } from '../stores/receivable'
import { useWalletStore } from '../stores/wallet'
import { formatBusinessNumber, normalizeBusinessNumber } from '../utils/businessNumber'

const PENDING_SYNC_STORAGE_KEY = 'receivablePendingBlockchainSync'
const TOKENIZE_TRANSACTION_TYPE = 'TOKENIZE_RECEIVABLE'
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
const isPageLoading = ref(true)
const hasLoadedReceivables = ref(false)
const isRefreshing = ref(false)
const isChainActionRunning = ref(false)
const tokenizationJournalStatus = ref('idle')
const tokenizationJournalReceivableId = ref(null)
const tokenizationJournalMessage = ref('')
const showForm = ref(false)
const buyerAttestationAccepted = ref(false)
let tokenizationJournalRequestSequence = 0
const form = reactive({
  buyerBusinessNumber: '',
  faceValue: '',
  fundingAmount: '',
  issueDate: new Date().toISOString().slice(0, 10),
  maturityDate: '',
  documentHash: '',
  description: '',
})

const selectedReceivable = computed(() => receivableStore.selectedReceivable)
const currentCompanyId = computed(() => authStore.user?.companyId)
const isSeller = computed(
  () =>
    selectedReceivable.value &&
    sameId(currentCompanyId.value, selectedReceivable.value.sellerCompanyId),
)
const isBuyer = computed(
  () =>
    selectedReceivable.value &&
    sameId(currentCompanyId.value, selectedReceivable.value.buyerCompanyId),
)
const buyerReviewRequired = computed(
  () => Boolean(isBuyer.value) && selectedReceivable.value.status === 'CREATED',
)
const hasCompleteChainMetadata = computed(() =>
  Boolean(
    selectedReceivable.value?.onchainReceivableId &&
    selectedReceivable.value?.contractAddress &&
    selectedReceivable.value?.createTxHash,
  ),
)
const hasCompleteVerificationMetadata = computed(
  () => hasCompleteChainMetadata.value && Boolean(selectedReceivable.value?.verifyTxHash),
)
const canCreateOnchain = computed(
  () =>
    !pendingSync.value &&
    isSeller.value &&
    selectedReceivable.value.status === 'CREATED' &&
    !selectedReceivable.value.onchainReceivableId,
)
const canVerify = computed(
  () => !pendingSync.value && buyerReviewRequired.value && hasCompleteChainMetadata.value,
)
const canSubmitVerification = computed(
  () =>
    canVerify.value &&
    buyerAttestationAccepted.value &&
    !isRefreshing.value &&
    !isChainActionRunning.value,
)
const isTokenizationCandidate = computed(
  () =>
    Boolean(isSeller.value) &&
    selectedReceivable.value?.status === 'VERIFIED' &&
    hasCompleteVerificationMetadata.value,
)
const isTokenizationJournalChecking = computed(() => tokenizationJournalStatus.value === 'checking')
const shouldShowTokenizationJournalGate = computed(
  () => !pendingSync.value && isTokenizationCandidate.value && !canTokenize.value,
)
const canTokenize = computed(
  () =>
    !pendingSync.value &&
    isTokenizationCandidate.value &&
    tokenizationJournalStatus.value === 'clear' &&
    sameId(tokenizationJournalReceivableId.value, selectedReceivable.value?.receivableId),
)
const buyerVerificationButtonText = computed(() => {
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
})
const pendingSyncForSelected = computed(
  () =>
    pendingSync.value &&
    selectedReceivable.value &&
    sameId(pendingSync.value.receivableId, selectedReceivable.value.receivableId),
)

onMounted(loadPage)

async function loadPage() {
  clearMessages()
  resetTokenizationJournalCheck()
  buyerAttestationAccepted.value = false
  isPageLoading.value = true
  hasLoadedReceivables.value = false
  try {
    await Promise.all([authStore.loadUser(), walletStore.loadWallet(), receivableStore.loadAll()])
    hasLoadedReceivables.value = true
    pendingSync.value = readPendingSynchronization(currentCompanyId.value)
    const recoveryRouteName = externalRecoveryRouteName(pendingSync.value)
    if (recoveryRouteName) {
      await router.replace({ name: recoveryRouteName })
      return
    }
    if (pendingSync.value) {
      await receivableStore.loadOne(pendingSync.value.receivableId)
      lastTxHash.value = pendingSync.value.payload.txHash
    } else if (receivableStore.receivables.length) {
      const initialReceivable =
        receivableStore.receivables.find(
          (receivable) => isBuyerFor(receivable) && receivable.status === 'FUNDED',
        ) ??
        receivableStore.receivables.find(
          (receivable) =>
            isBuyerFor(receivable) &&
            receivable.status === 'CREATED' &&
            hasCompleteBlockchainMetadata(receivable),
        ) ??
        receivableStore.receivables.find(
          (receivable) => isBuyerFor(receivable) && receivable.status === 'CREATED',
        ) ??
        receivableStore.receivables.find(
          (receivable) =>
            sameId(currentCompanyId.value, receivable.sellerCompanyId) &&
            receivable.status === 'VERIFIED',
        ) ??
        receivableStore.receivables[0]
      await receivableStore.loadOne(initialReceivable.receivableId)
    } else {
      receivableStore.clearSelection()
    }
    await inspectSelectedTokenizationJournal()
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    isPageLoading.value = false
  }
}

async function submit() {
  clearMessages()
  isSubmitting.value = true
  try {
    await receivableStore.create({
      ...form,
      buyerBusinessNumber: normalizeBusinessNumber(form.buyerBusinessNumber),
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
  resetTokenizationJournalCheck()
  buyerAttestationAccepted.value = false
  try {
    await receivableStore.loadOne(receivableId)
    if (pendingSyncForSelected.value) {
      lastTxHash.value = pendingSync.value.payload.txHash
    }
    await inspectSelectedTokenizationJournal()
  } catch (error) {
    errorMessage.value = error.message
  }
}

async function selectPendingReceivable() {
  if (!pendingSync.value) return
  const recoveryRouteName = externalRecoveryRouteName(pendingSync.value)
  if (recoveryRouteName) {
    await router.push({ name: recoveryRouteName })
    return
  }
  await selectReceivable(pendingSync.value.receivableId)
}

async function refreshSelectedReceivable() {
  const receivableId = selectedReceivable.value?.receivableId
  if (!receivableId) return

  clearMessages({ keepTransaction: Boolean(pendingSync.value) })
  resetTokenizationJournalCheck()
  buyerAttestationAccepted.value = false
  isRefreshing.value = true
  try {
    await Promise.all([receivableStore.loadAll(), receivableStore.loadOne(receivableId)])
    successMessage.value = '채권의 최신 상태를 불러왔습니다.'
    await inspectSelectedTokenizationJournal()
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
  actionStage.value = 'MetaMask 서명 후 GIWA 블록 확인을 기다리고 있습니다...'
  try {
    const result = await createReceivableOnchain(receivable, (submitted) => {
      savePendingSynchronization({
        type: 'chain-created',
        phase: 'submitted',
        receivableId: receivable.receivableId,
        companyId: currentCompanyId.value,
        payload: submitted,
      })
      lastTxHash.value = submitted.txHash
    })
    savePendingSynchronization({
      type: 'chain-created',
      phase: 'confirmed',
      journalConfirmed: true,
      receivableId: receivable.receivableId,
      companyId: currentCompanyId.value,
      payload: result,
    })
    lastTxHash.value = result.txHash
    await synchronizePending()
  } catch (error) {
    lastTxHash.value = error.txHash ?? pendingSync.value?.payload.txHash ?? ''
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
    errorMessage.value = '채권 내용을 확인하고 Buyer 검증 동의 항목을 선택해 주세요.'
    return
  }

  clearMessages()
  isChainActionRunning.value = true
  actionStage.value = 'Buyer MetaMask 서명 후 GIWA 블록 확인을 기다리고 있습니다...'
  try {
    const result = await verifyReceivableOnchain(receivable, (submitted) => {
      savePendingSynchronization({
        type: 'verified',
        phase: 'submitted',
        receivableId: receivable.receivableId,
        companyId: currentCompanyId.value,
        payload: submitted,
      })
      lastTxHash.value = submitted.txHash
    })
    savePendingSynchronization({
      type: 'verified',
      phase: 'confirmed',
      journalConfirmed: true,
      receivableId: receivable.receivableId,
      companyId: currentCompanyId.value,
      payload: result,
    })
    lastTxHash.value = result.txHash
    await synchronizePending()
  } catch (error) {
    lastTxHash.value = error.txHash ?? pendingSync.value?.payload.txHash ?? ''
    clearTerminalPendingTransaction(error)
    errorMessage.value = error.message
    actionStage.value = ''
  } finally {
    isChainActionRunning.value = false
  }
}

async function tokenizeOnchain() {
  const requestedReceivable = selectedReceivable.value
  if (!requestedReceivable) return
  if (pendingSync.value || !isTokenizationCandidateFor(requestedReceivable)) {
    errorMessage.value = 'Buyer 검증과 온체인 메타데이터를 확인한 뒤 다시 시도해 주세요.'
    return
  }

  clearMessages()
  const journalAllowsMint = await inspectSelectedTokenizationJournal()
  const receivable = selectedReceivable.value
  if (
    !journalAllowsMint ||
    pendingSync.value ||
    !sameId(requestedReceivable.receivableId, receivable?.receivableId) ||
    !isTokenizationCandidateFor(receivable)
  ) {
    return
  }

  isChainActionRunning.value = true
  actionStage.value = 'Seller MetaMask 서명 후 GIWA NFT 민팅 블록 확인을 기다리고 있습니다...'
  try {
    const result = await tokenizeReceivableOnchain(receivable, (submitted) => {
      savePendingSynchronization({
        type: 'tokenized',
        phase: 'submitted',
        receivableId: receivable.receivableId,
        companyId: currentCompanyId.value,
        payload: submitted,
      })
      lastTxHash.value = submitted.txHash
    })
    savePendingSynchronization({
      type: 'tokenized',
      phase: 'confirmed',
      journalConfirmed: true,
      receivableId: receivable.receivableId,
      companyId: currentCompanyId.value,
      payload: result,
    })
    lastTxHash.value = result.txHash
    await synchronizePending()
  } catch (error) {
    lastTxHash.value = error.txHash ?? pendingSync.value?.payload.txHash ?? ''
    clearTerminalPendingTransaction(error)
    errorMessage.value = error.message
    actionStage.value = ''
  } finally {
    isChainActionRunning.value = false
  }
}

async function refreshTokenizationJournal() {
  clearMessages({ keepTransaction: Boolean(pendingSync.value) })
  await inspectSelectedTokenizationJournal()
}

async function inspectSelectedTokenizationJournal() {
  const receivable = selectedReceivable.value
  const storedTokenization =
    pendingSync.value?.type === 'tokenized' &&
    sameId(pendingSync.value.receivableId, receivable?.receivableId)
      ? pendingSync.value
      : null
  if (receivable?.status === 'TOKENIZED') {
    if (storedTokenization) {
      clearPendingSynchronization()
      lastTxHash.value = receivable.tokenizeTxHash ?? storedTokenization.payload?.txHash ?? ''
    }
    resetTokenizationJournalCheck()
    return false
  }
  if (!isTokenizationCandidateFor(receivable)) {
    resetTokenizationJournalCheck()
    return false
  }

  const localTokenization = storedTokenization
  if (pendingSync.value && !localTokenization) {
    tokenizationJournalRequestSequence += 1
    setTokenizationJournalState(
      'blocked',
      receivable.receivableId,
      `채권 #${pendingSync.value.receivableId}의 기존 블록체인 작업을 먼저 처리해야 합니다.`,
    )
    return false
  }

  const requestSequence = ++tokenizationJournalRequestSequence
  const receivableId = receivable.receivableId
  setTokenizationJournalState(
    'checking',
    receivableId,
    '서버의 기존 NFT 민팅 이력을 확인하고 있습니다. 확인 전에는 새 민팅을 시작할 수 없습니다.',
  )

  try {
    const transactions = await getReceivableBlockchainTransactions(receivableId)
    if (!isCurrentTokenizationJournalRequest(requestSequence, receivableId)) {
      return false
    }
    if (!Array.isArray(transactions)) {
      throw new Error('서버의 민팅 이력 응답 형식을 확인할 수 없습니다.')
    }

    const tokenizationTransactions = transactions.filter(
      (transaction) => transaction?.transactionType === TOKENIZE_TRANSACTION_TYPE,
    )
    const localJournal = tokenizationTransactions.find((transaction) =>
      sameHex(transaction?.txHash, localTokenization?.payload?.txHash),
    )
    const selectedJournal = selectTokenizationJournal(
      tokenizationTransactions,
      localTokenization?.payload?.txHash,
      receivable,
    )

    if (selectedJournal?.kind === 'unknown') {
      setTokenizationJournalState(
        'blocked',
        receivableId,
        '서버에 상태를 판별할 수 없는 민팅 이력이 있습니다. 새 민팅을 진행하지 말고 서버 상태를 다시 확인해 주세요.',
      )
      return false
    }

    if (!selectedJournal) {
      if (localTokenization) {
        if (localJournal?.txStatus === 'FAILED') {
          clearPendingSynchronization()
          lastTxHash.value = ''
          setTokenizationJournalState(
            'clear',
            receivableId,
            '기존 민팅 트랜잭션이 실패로 확정되어 복구 대기를 정리했습니다. 서버에 성공하거나 진행 중인 다른 민팅은 없습니다.',
          )
          return true
        }
        setTokenizationJournalState(
          'adopted',
          receivableId,
          '브라우저에 복구할 민팅 트랜잭션이 남아 있습니다. 서버 저널에 아직 보이지 않더라도 새 민팅을 보내지 말고 기존 트랜잭션 확인을 이어받아 주세요.',
        )
        return false
      }
      setTokenizationJournalState(
        'clear',
        receivableId,
        '서버에서 진행 중이거나 성공한 기존 NFT 민팅이 확인되지 않았습니다.',
      )
      return true
    }

    if (localTokenization && !localJournal && selectedJournal.kind === 'pending') {
      const additionalServerPendingCount = tokenizationTransactions.filter(
        (transaction) => transaction?.txStatus === 'PENDING',
      ).length
      savePendingSynchronization({
        ...localTokenization,
        additionalServerPendingCount,
      })
      lastTxHash.value = localTokenization.payload.txHash
      setTokenizationJournalState(
        'adopted',
        receivableId,
        `브라우저에 저장된 기존 민팅을 먼저 복구합니다. 서버에도 별도 PENDING ${additionalServerPendingCount}건이 있어 새 민팅은 계속 차단됩니다.`,
      )
      return false
    }

    const journal = selectedJournal.journal
    if (!isValidTokenizationJournal(journal, receivable)) {
      setTokenizationJournalState(
        'blocked',
        receivableId,
        '서버 민팅 이력의 회사·지갑·컨트랙트 정보가 현재 채권과 일치하지 않습니다. 안전을 위해 새 민팅을 차단했습니다.',
      )
      return false
    }

    if (selectedJournal.kind === 'confirmed') {
      const hasRpcProof = hasCompleteTokenizationRpcProof(journal, receivable)
      savePendingSynchronization({
        type: 'tokenized',
        phase: 'confirmed',
        journalConfirmed: true,
        recoveredFromServerJournal: true,
        serverRpcProof: hasRpcProof,
        receivableId,
        companyId: currentCompanyId.value,
        payload: {
          txHash: journal.txHash,
          contractAddress: journal.contractAddress,
          ...(hasRpcProof ? { tokenId: String(journal.eventTokenId) } : {}),
        },
      })
      lastTxHash.value = journal.txHash
      setTokenizationJournalState(
        'adopted',
        receivableId,
        hasRpcProof
          ? '이미 성공하고 RPC 검증된 NFT 민팅을 확인했습니다. MetaMask를 다시 호출하지 말고 민팅 결과를 DB에 동기화해 주세요.'
          : '이미 CONFIRMED 처리된 NFT 민팅을 확인했습니다. MetaMask를 다시 호출하지 말고 서버 RPC 재검증과 DB 동기화를 진행해 주세요.',
      )
      return false
    }

    const pendingTransactions = tokenizationTransactions.filter(
      (transaction) => transaction?.txStatus === 'PENDING',
    )
    const existingPayload = sameHex(localTokenization?.payload?.txHash, journal.txHash)
      ? localTokenization.payload
      : {}
    savePendingSynchronization({
      type: 'tokenized',
      phase: 'submitted',
      recoveredFromServerJournal: true,
      pendingTransactionCount: pendingTransactions.length,
      receivableId,
      companyId: currentCompanyId.value,
      payload: {
        ...existingPayload,
        txHash: journal.txHash,
        contractAddress: journal.contractAddress,
      },
    })
    lastTxHash.value = journal.txHash
    setTokenizationJournalState(
      'adopted',
      receivableId,
      pendingTransactions.length > 1
        ? `서버에 진행 중인 민팅 ${pendingTransactions.length}건이 있습니다. 새 민팅은 차단되며, 우선 선택된 기존 트랜잭션의 블록 확인을 이어받아야 합니다.`
        : '서버에 진행 중인 민팅이 있습니다. 새 민팅을 보내지 말고 기존 트랜잭션의 블록 확인을 이어받아 주세요.',
    )
    return false
  } catch (error) {
    if (!isCurrentTokenizationJournalRequest(requestSequence, receivableId)) {
      return false
    }
    setTokenizationJournalState(
      'error',
      receivableId,
      `서버의 기존 민팅 이력을 확인하지 못해 새 민팅을 차단했습니다. 서버 연결을 확인한 뒤 다시 조회해 주세요. (${error.message})`,
    )
    return false
  }
}

function selectTokenizationJournal(transactions, localTxHash, receivable) {
  const confirmedTransactions = transactions.filter(
    (transaction) => transaction?.txStatus === 'CONFIRMED',
  )
  const rpcConfirmed = confirmedTransactions.find((transaction) =>
    hasCompleteTokenizationRpcProof(transaction, receivable),
  )
  if (rpcConfirmed) {
    return { kind: 'confirmed', journal: rpcConfirmed }
  }
  if (confirmedTransactions.length) {
    return {
      kind: 'confirmed',
      journal: confirmedTransactions[0],
    }
  }

  const pendingTransactions = transactions.filter(
    (transaction) => transaction?.txStatus === 'PENDING',
  )
  const localPending = pendingTransactions.find((transaction) =>
    sameHex(transaction.txHash, localTxHash),
  )
  if (localPending) {
    return { kind: 'pending', journal: localPending }
  }
  if (pendingTransactions.length) {
    return { kind: 'pending', journal: pendingTransactions[0] }
  }

  const hasUnknownStatus = transactions.some((transaction) => transaction?.txStatus !== 'FAILED')
  return hasUnknownStatus ? { kind: 'unknown' } : null
}

function isValidTokenizationJournal(journal, receivable) {
  return (
    sameId(journal?.receivableId, receivable.receivableId) &&
    sameId(journal?.companyId, currentCompanyId.value) &&
    sameHex(journal?.walletAddress, receivable.sellerWalletAddress) &&
    sameHex(journal?.contractAddress, receivable.contractAddress) &&
    journal?.functionName === 'tokenizeReceivable' &&
    isTransactionHash(journal?.txHash)
  )
}

function hasCompleteTokenizationRpcProof(journal, receivable) {
  return (
    journal?.txStatus === 'CONFIRMED' &&
    Boolean(journal.rpcVerifiedAt) &&
    isPositiveIntegerString(journal.chainId) &&
    isPositiveIntegerString(journal.blockNumber) &&
    isTransactionHash(journal.blockHash) &&
    isPositiveIntegerString(journal.gasUsed) &&
    isNonNegativeDecimalString(journal.effectiveGasPrice) &&
    sameId(journal.eventReceivableId, receivable.onchainReceivableId) &&
    isPositiveIntegerString(journal.eventTokenId) &&
    isPositiveIntegerString(journal.verificationVersion)
  )
}

function setTokenizationJournalState(status, receivableId, message) {
  tokenizationJournalStatus.value = status
  tokenizationJournalReceivableId.value = receivableId
  tokenizationJournalMessage.value = message
}

function resetTokenizationJournalCheck() {
  tokenizationJournalRequestSequence += 1
  setTokenizationJournalState('idle', null, '')
}

function isCurrentTokenizationJournalRequest(requestSequence, receivableId) {
  return (
    requestSequence === tokenizationJournalRequestSequence &&
    isTokenizationCandidateFor(selectedReceivable.value) &&
    sameId(selectedReceivable.value?.receivableId, receivableId)
  )
}

async function retryPendingSync() {
  if (!pendingSync.value) return
  const recoveryRouteName = externalRecoveryRouteName(pendingSync.value)
  if (recoveryRouteName) {
    await router.push({ name: recoveryRouteName })
    return
  }
  clearMessages({ keepTransaction: true })
  isChainActionRunning.value = true
  try {
    if (
      pendingSync.value.type === 'tokenized' &&
      pendingSync.value.recoveredFromServerJournal &&
      pendingSync.value.phase === 'confirmed'
    ) {
      await inspectSelectedTokenizationJournal()
      if (
        tokenizationJournalStatus.value !== 'adopted' ||
        pendingSync.value?.type !== 'tokenized' ||
        !pendingSync.value.recoveredFromServerJournal ||
        pendingSync.value.phase !== 'confirmed'
      ) {
        if (
          tokenizationJournalStatus.value === 'error' ||
          tokenizationJournalStatus.value === 'blocked'
        ) {
          errorMessage.value = tokenizationJournalMessage.value
        }
        return
      }
      await synchronizePending()
      return
    }
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

  actionStage.value = '기존 GIWA 트랜잭션의 블록 확인을 이어받고 있습니다...'
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
      payload: result,
    })
    lastTxHash.value = result.txHash
    await synchronizePending()
  } catch (error) {
    actionStage.value = ''
    lastTxHash.value =
      error.txHash ?? pendingSync.value?.payload.txHash ?? synchronization.payload.txHash
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
  if (
    !synchronization.journalConfirmed &&
    isSynchronizationAlreadyApplied(synchronization, selectedReceivable.value)
  ) {
    successMessage.value = '이미 서버에 반영된 블록체인 작업을 확인했습니다.'
    clearPendingSynchronization()
    actionStage.value = ''
    return
  }
  if (!synchronization.journalConfirmed) {
    await resumePendingConfirmation()
    return
  }

  actionStage.value = '온체인 트랜잭션 확인 완료 · 서버 상태를 동기화하고 있습니다...'
  try {
    switch (synchronization.type) {
      case 'chain-created':
        await receivableStore.markChainCreated(
          synchronization.receivableId,
          synchronization.payload,
        )
        successMessage.value =
          'GIWA 채권 생성과 서버 동기화가 완료되었습니다. Buyer 검증을 기다립니다.'
        break
      case 'verified':
        await receivableStore.markVerified(synchronization.receivableId, synchronization.payload)
        successMessage.value =
          'Buyer 검증과 서버 동기화가 완료되었습니다. 다음 단계는 Seller 토큰화입니다.'
        buyerAttestationAccepted.value = false
        break
      case 'tokenized':
        await receivableStore.markTokenized(synchronization.receivableId, {
          txHash: synchronization.payload.txHash,
        })
        successMessage.value =
          '채권 토큰화와 NFT 민팅이 완료되었습니다. 다음 단계는 Funder 자금 공급입니다.'
        break
      default:
        throw new Error('저장된 블록체인 작업 종류를 확인할 수 없습니다.')
    }
    clearPendingSynchronization()
    actionStage.value = ''
  } catch (error) {
    const isTerminal = clearTerminalPendingTransaction(error)
    const isServerRecoveredTokenization =
      synchronization.type === 'tokenized' && synchronization.recoveredFromServerJournal
    if (!isServerRecoveredTokenization && error.code === 'BLOCKCHAIN_TRANSACTION_NOT_CONFIRMED') {
      savePendingSynchronization({
        ...synchronization,
        journalConfirmed: false,
      })
    } else if (
      !isServerRecoveredTokenization &&
      error.code === 'BLOCKCHAIN_SYNCHRONIZATION_EVENT_MISMATCH'
    ) {
      savePendingSynchronization({
        ...synchronization,
        phase: 'submitted',
      })
    }
    actionStage.value = ''
    if (isTerminal) {
      errorMessage.value =
        `서버의 온체인 검증에서 복구할 수 없는 오류를 확인해 대기 작업을 정리했습니다. ` +
        `화면을 새로고침한 뒤 지갑·네트워크·채권 정보를 확인해 주세요. (${error.message})`
      return
    }
    if (isServerRecoveredTokenization) {
      errorMessage.value =
        `기존 민팅의 서버 동기화에 실패했습니다. MetaMask로 다시 민팅하지 말고 ` +
        `아래 버튼으로 서버 저널을 재확인한 뒤 DB 동기화만 다시 진행해 주세요. (${error.message})`
      return
    }
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
    synchronizations = JSON.parse(localStorage.getItem(PENDING_SYNC_STORAGE_KEY) ?? '{}')
  } catch {
    synchronizations = {}
  }
  synchronizations[String(synchronization.companyId)] = synchronization
  localStorage.setItem(PENDING_SYNC_STORAGE_KEY, JSON.stringify(synchronizations))
}

function clearPendingSynchronization() {
  const companyId = pendingSync.value?.companyId ?? currentCompanyId.value
  if (pendingSync.value?.type === 'tokenized') {
    tokenizationJournalRequestSequence += 1
  }
  pendingSync.value = null
  if (companyId == null) return

  try {
    const synchronizations = JSON.parse(localStorage.getItem(PENDING_SYNC_STORAGE_KEY) ?? '{}')
    delete synchronizations[String(companyId)]
    if (Object.keys(synchronizations).length) {
      localStorage.setItem(PENDING_SYNC_STORAGE_KEY, JSON.stringify(synchronizations))
    } else {
      localStorage.removeItem(PENDING_SYNC_STORAGE_KEY)
    }
  } catch {
    localStorage.removeItem(PENDING_SYNC_STORAGE_KEY)
  }
}

function clearTerminalPendingTransaction(error) {
  const isTerminal =
    error.code === 'TRANSACTION_FAILED' ||
    error.code === 'TRANSACTION_CANCELLED' ||
    error.code === 'BLOCKCHAIN_TRANSACTION_FAILED' ||
    error.code === 'BLOCKCHAIN_TRANSACTION_REVERTED' ||
    error.code === 'BLOCKCHAIN_TRANSACTION_VERIFICATION_FAILED' ||
    error.code === 'BLOCKCHAIN_EVENT_MISMATCH'

  if (isTerminal) {
    clearPendingSynchronization()
  }
  return isTerminal
}

function isSynchronizationAlreadyApplied(synchronization, receivable) {
  if (!receivable) return false

  if (synchronization.type === 'chain-created') {
    return (
      sameId(synchronization.payload.onchainReceivableId, receivable.onchainReceivableId) &&
      sameHex(synchronization.payload.contractAddress, receivable.contractAddress) &&
      sameHex(synchronization.payload.txHash, receivable.createTxHash)
    )
  }

  if (synchronization.type === 'verified') {
    return sameHex(synchronization.payload.txHash, receivable.verifyTxHash)
  }

  if (synchronization.type === 'tokenized') {
    return (
      sameHex(synchronization.payload.txHash, receivable.tokenizeTxHash) &&
      sameId(synchronization.payload.tokenId, receivable.tokenId)
    )
  }

  return false
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

function isBuyerFor(receivable) {
  return sameId(currentCompanyId.value, receivable.buyerCompanyId)
}

function externalRecoveryRouteName(synchronization) {
  if (synchronization?.type === 'funded') return 'funding'
  if (synchronization?.type === 'repaid') return 'repayment'
  return null
}

function counterpartyName(receivable) {
  return isBuyerFor(receivable) ? receivable.sellerCompanyName : receivable.buyerCompanyName
}

function counterpartyRole(receivable) {
  return isBuyerFor(receivable) ? 'Seller' : 'Buyer'
}

function receivableActionLabel(receivable) {
  if (receivable.status === 'REPAID') {
    return '상환 완료'
  }
  if (receivable.status === 'FUNDED') {
    return isBuyerFor(receivable) ? 'Buyer 상환 필요' : 'Buyer 상환 대기'
  }
  if (isBuyerFor(receivable) && receivable.status === 'CREATED') {
    return hasCompleteBlockchainMetadata(receivable) ? 'Buyer 검증 필요' : 'Seller 온체인 생성 대기'
  }
  if (isBuyerFor(receivable) && receivable.status === 'VERIFIED') {
    return 'Seller 토큰화 대기'
  }
  if (
    sameId(currentCompanyId.value, receivable.sellerCompanyId) &&
    receivable.status === 'CREATED'
  ) {
    return receivable.onchainReceivableId ? 'Buyer 검증 대기' : 'Seller 온체인 생성 필요'
  }
  if (
    sameId(currentCompanyId.value, receivable.sellerCompanyId) &&
    receivable.status === 'VERIFIED'
  ) {
    return 'Seller 토큰화 필요'
  }
  if (receivable.status === 'TOKENIZED') {
    return 'Funder 자금 공급 대기'
  }
  return receivable.status
}

function hasCompleteBlockchainMetadata(receivable) {
  return Boolean(
    receivable?.onchainReceivableId && receivable?.contractAddress && receivable?.createTxHash,
  )
}

function isTokenizationCandidateFor(receivable) {
  return Boolean(
    receivable &&
    sameId(currentCompanyId.value, receivable.sellerCompanyId) &&
    receivable.status === 'VERIFIED' &&
    hasCompleteBlockchainMetadata(receivable) &&
    receivable.verifyTxHash,
  )
}

function isTransactionHash(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

function isPositiveIntegerString(value) {
  return /^[1-9][0-9]*$/.test(String(value ?? ''))
}

function isNonNegativeDecimalString(value) {
  return /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(String(value ?? ''))
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
        <button class="secondary" type="button" @click="router.push({ name: 'dashboard' })">
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
            <input v-model="form.faceValue" type="number" min="1" step="1" required />
          </label>
          <label>
            펀딩 요청 금액 (KRW)
            <input v-model="form.fundingAmount" type="number" min="1" step="1" required />
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
          <input v-model="form.documentHash" maxlength="66" placeholder="0x..." />
        </label>
        <label>
          설명 (선택)
          <textarea v-model="form.description" maxlength="1000" rows="3"></textarea>
        </label>
        <button type="submit" :disabled="isSubmitting">
          {{ isSubmitting ? '등록 중...' : 'DB에 등록' }}
        </button>
      </form>
    </section>

    <div class="content-grid">
      <section class="panel">
        <h2>채권 목록</h2>
        <p v-if="isPageLoading" class="empty loading-state" role="status">
          채권 목록을 불러오고 있습니다...
        </p>
        <p v-else-if="hasLoadedReceivables && !receivableStore.receivables.length" class="empty">
          등록되거나 배정된 채권이 없습니다.
        </p>
        <button
          v-for="item in receivableStore.receivables"
          v-show="!isPageLoading"
          :key="item.receivableId"
          class="receivable-row"
          :class="{
            selected: sameId(selectedReceivable?.receivableId, item.receivableId),
          }"
          type="button"
          :aria-pressed="sameId(selectedReceivable?.receivableId, item.receivableId)"
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
          <span class="amount"> {{ formatAmount(item.faceValue) }} {{ item.currencyCode }} </span>
          <span class="status">{{ item.status }}</span>
        </button>
      </section>

      <section class="panel details">
        <h2>상세 정보</h2>
        <p v-if="isPageLoading" class="empty loading-state" role="status">
          채권 상세 정보를 준비하고 있습니다...
        </p>
        <template v-else-if="selectedReceivable">
          <dl>
            <dt>채권 번호</dt>
            <dd>#{{ selectedReceivable.receivableId }}</dd>
            <dt>Seller</dt>
            <dd>{{ selectedReceivable.sellerCompanyName }}</dd>
            <dt>Buyer</dt>
            <dd>{{ selectedReceivable.buyerCompanyName }}</dd>
            <dt>Funder</dt>
            <dd>{{ selectedReceivable.funderCompanyName || '-' }}</dd>
            <dt>채권 금액</dt>
            <dd>{{ formatAmount(selectedReceivable.faceValue) }} KRW</dd>
            <dt>펀딩 요청</dt>
            <dd>{{ formatAmount(selectedReceivable.fundingAmount) }} KRW</dd>
            <dt>발행일</dt>
            <dd>{{ selectedReceivable.issueDate }}</dd>
            <dt>만기일</dt>
            <dd>{{ selectedReceivable.maturityDate }}</dd>
            <dt>Seller 지갑</dt>
            <dd class="technical-value">{{ selectedReceivable.sellerWalletAddress }}</dd>
            <dt>Buyer 지갑</dt>
            <dd class="technical-value">{{ selectedReceivable.buyerWalletAddress }}</dd>
            <dt>Funder 지갑</dt>
            <dd class="technical-value">{{ selectedReceivable.funderWalletAddress || '-' }}</dd>
            <dt>문서 해시</dt>
            <dd class="technical-value">
              {{ selectedReceivable.documentHash || '등록되지 않음' }}
            </dd>
            <dt>상태</dt>
            <dd>{{ selectedReceivable.status }}</dd>
            <dt>온체인 ID</dt>
            <dd>{{ selectedReceivable.onchainReceivableId || '-' }}</dd>
            <dt>컨트랙트</dt>
            <dd class="chain-reference">
              <span>{{ selectedReceivable.contractAddress || '-' }}</span>
              <a
                v-if="addressExplorerUrl(selectedReceivable.contractAddress)"
                class="explorer-button"
                :href="addressExplorerUrl(selectedReceivable.contractAddress)"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="컨트랙트 주소를 익스플로러에서 보기"
              >
                익스플로러
              </a>
            </dd>
            <dt>생성 Tx</dt>
            <dd class="chain-reference">
              <span>{{ selectedReceivable.createTxHash || '-' }}</span>
              <a
                v-if="transactionExplorerUrl(selectedReceivable.createTxHash)"
                class="explorer-button"
                :href="transactionExplorerUrl(selectedReceivable.createTxHash)"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="채권 생성 트랜잭션을 익스플로러에서 보기"
              >
                익스플로러
              </a>
            </dd>
            <dt>검증 Tx</dt>
            <dd class="chain-reference">
              <span>{{ selectedReceivable.verifyTxHash || '-' }}</span>
              <a
                v-if="transactionExplorerUrl(selectedReceivable.verifyTxHash)"
                class="explorer-button"
                :href="transactionExplorerUrl(selectedReceivable.verifyTxHash)"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Buyer 검증 트랜잭션을 익스플로러에서 보기"
              >
                익스플로러
              </a>
            </dd>
            <dt>NFT 토큰 ID</dt>
            <dd>{{ selectedReceivable.tokenId || '-' }}</dd>
            <dt>토큰화 Tx</dt>
            <dd class="chain-reference">
              <span>{{ selectedReceivable.tokenizeTxHash || '-' }}</span>
              <a
                v-if="transactionExplorerUrl(selectedReceivable.tokenizeTxHash)"
                class="explorer-button"
                :href="transactionExplorerUrl(selectedReceivable.tokenizeTxHash)"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="NFT 토큰화 트랜잭션을 익스플로러에서 보기"
              >
                익스플로러
              </a>
            </dd>
            <dt>펀딩 Tx</dt>
            <dd class="chain-reference">
              <span>{{ selectedReceivable.fundingTxHash || '-' }}</span>
              <a
                v-if="transactionExplorerUrl(selectedReceivable.fundingTxHash)"
                class="explorer-button"
                :href="transactionExplorerUrl(selectedReceivable.fundingTxHash)"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="자금 공급 트랜잭션을 익스플로러에서 보기"
              >
                익스플로러
              </a>
            </dd>
            <dt>상환 Tx</dt>
            <dd class="chain-reference">
              <span>{{ selectedReceivable.repayTxHash || '-' }}</span>
              <a
                v-if="transactionExplorerUrl(selectedReceivable.repayTxHash)"
                class="explorer-button"
                :href="transactionExplorerUrl(selectedReceivable.repayTxHash)"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Buyer 상환 트랜잭션을 익스플로러에서 보기"
              >
                익스플로러
              </a>
            </dd>
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
              온체인은 실제 거래 사실을 자동으로 판단하지 않습니다. 위의 거래 조건을 확인한 Buyer
              회사의 지갑 서명이 채무 확인 증거로 기록됩니다.
            </p>
            <ul class="review-checklist">
              <li>Seller와 Buyer 회사 및 등록 지갑이 올바른지 확인</li>
              <li>채권 금액, 펀딩 요청 금액, 발행일과 만기일 확인</li>
              <li>설명과 문서 해시가 실제 거래 증빙과 일치하는지 확인</li>
            </ul>
            <p v-if="!hasCompleteChainMetadata" class="review-prerequisite" role="status">
              지금 채권 내용을 검토할 수 있습니다. MetaMask 서명은 Seller가 미검증 채권을 GIWA에
              생성한 뒤 활성화됩니다.
            </p>
            <p v-else class="review-ready" role="status">
              Seller의 GIWA 생성이 완료되었습니다. 서명 직전에 화면 정보와 온체인 CREATED 데이터를
              다시 대조합니다.
            </p>
            <label class="attestation">
              <input
                v-model="buyerAttestationAccepted"
                type="checkbox"
                :disabled="isChainActionRunning || Boolean(pendingSync)"
              />
              <span>
                위 거래 조건과 증빙을 확인했으며, Buyer 회사로서 해당 채무 내용을 확인합니다.
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
              <button type="button" :disabled="!canSubmitVerification" @click="verifyOnchain">
                {{ buyerVerificationButtonText }}
              </button>
            </div>
          </section>

          <div class="workflow-card">
            <strong>현재 단계</strong>
            <p v-if="pendingSyncForSelected && pendingSync.phase === 'submitted'">
              <template v-if="pendingSync.recoveredFromServerJournal">
                서버 저널에서
                {{
                  pendingSync.pendingTransactionCount > 1
                    ? `진행 중인 민팅 ${pendingSync.pendingTransactionCount}건`
                    : '진행 중인 민팅'
                }}을 확인했습니다. 새 민팅을 보내지 말고 아래 트랜잭션의 블록 확인을 이어받아
                주세요. 서버 조회만으로는 nonce·교체 정보를 모두 복원할 수 없어 기존 해시를 기준으로
                안전하게 확인합니다.
              </template>
              <template v-else>
                트랜잭션이 GIWA에 제출되었습니다. 새 트랜잭션을 보내지 말고 기존 블록 확인을
                이어받아 주세요.
              </template>
            </p>
            <p v-else-if="pendingSyncForSelected">
              <template v-if="pendingSync.recoveredFromServerJournal">
                이미 CONFIRMED 처리된 NFT 민팅을 서버 저널에서 확인했습니다. MetaMask로 다시
                민팅하지 말고
                {{
                  pendingSync.serverRpcProof
                    ? '확인된 민팅 결과를 DB에 동기화해 주세요.'
                    : '서버 RPC 재검증과 DB 동기화를 재개해 주세요.'
                }}
              </template>
              <template v-else>
                온체인 트랜잭션은 성공했습니다. 새 트랜잭션을 보내기 전에 서버 동기화를 완료해
                주세요.
              </template>
            </p>
            <p v-else-if="pendingSync">
              채권 #{{ pendingSync.receivableId }}의 서버 동기화가 남아 있어 새 블록체인 요청이 잠겨
              있습니다.
            </p>
            <p v-else-if="canCreateOnchain">
              DB 등록이 끝났습니다. Seller 지갑으로 GIWA 채권을 생성해 주세요.
            </p>
            <p
              v-else-if="
                isBuyer && selectedReceivable.status === 'CREATED' && !hasCompleteChainMetadata
              "
            >
              Buyer 검토 대상입니다. Seller의 GIWA 온체인 생성을 기다리는 동안 위 채권 내용을 먼저
              확인할 수 있습니다.
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
            <p v-else-if="shouldShowTokenizationJournalGate" aria-live="polite">
              {{ tokenizationJournalMessage || '서버의 기존 NFT 민팅 이력을 확인해야 합니다.' }}
            </p>
            <p v-else-if="canTokenize">
              Buyer 검증이 완료되었습니다. Seller 지갑으로 채권 NFT를 민팅해 주세요.
            </p>
            <p v-else-if="isBuyer && selectedReceivable.status === 'VERIFIED'">
              채권 검증이 완료되었습니다. Seller의 NFT 민팅을 기다리고 있습니다.
            </p>
            <p v-else-if="isSeller && selectedReceivable.status === 'VERIFIED'">
              Buyer 검증은 완료되었지만 토큰화에 필요한 온체인 메타데이터가 부족합니다. 페이지를
              새로고침해 주세요.
            </p>
            <p v-else-if="selectedReceivable.status === 'TOKENIZED'">
              채권 NFT 민팅이 완료되었습니다. Funder 자금 공급을 기다리고 있습니다.
            </p>
            <p v-else-if="isBuyer && selectedReceivable.status === 'FUNDED'">
              Funder 자금 공급이 완료되었습니다. Buyer 지갑으로 채권 금액을 상환해 주세요.
            </p>
            <p v-else-if="selectedReceivable.status === 'FUNDED'">
              Funder 자금 공급이 완료되었습니다. Buyer 상환을 기다리고 있습니다.
            </p>
            <p v-else-if="selectedReceivable.status === 'REPAID'">
              Buyer 상환이 완료되었습니다. 채권 상태가 REPAID로 기록되었습니다.
            </p>
            <p v-else>현재 계정에서 실행할 생성·검증 작업이 없습니다.</p>

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
              {{ isChainActionRunning ? 'GIWA 확인 중...' : 'Seller 지갑으로 GIWA 채권 생성' }}
            </button>
            <button
              v-if="shouldShowTokenizationJournalGate"
              class="secondary"
              type="button"
              :disabled="isTokenizationJournalChecking || isRefreshing || isChainActionRunning"
              @click="refreshTokenizationJournal"
            >
              {{
                isTokenizationJournalChecking
                  ? '서버 민팅 이력 확인 중...'
                  : '서버 민팅 상태 다시 확인'
              }}
            </button>
            <button
              v-if="canTokenize"
              type="button"
              :disabled="isChainActionRunning"
              @click="tokenizeOnchain"
            >
              {{ isChainActionRunning ? 'NFT 민팅 확인 중...' : 'Seller 지갑으로 채권 NFT 민팅' }}
            </button>
            <button
              v-if="isBuyer && selectedReceivable.status === 'FUNDED'"
              type="button"
              @click="router.push({ name: 'repayment' })"
            >
              Buyer 채권 상환 화면으로 이동
            </button>
          </div>

          <div v-if="pendingSyncForSelected" class="sync-alert" role="alert">
            <strong v-if="pendingSync.phase === 'submitted'">
              {{
                pendingSync.type === 'tokenized'
                  ? '기존 민팅 제출 확인 · 새 민팅 금지'
                  : 'GIWA 제출 완료 · 블록 확인 필요'
              }}
            </strong>
            <strong v-else-if="pendingSync.recoveredFromServerJournal">
              기존 민팅 성공 확인 · MetaMask 재호출 금지
            </strong>
            <strong v-else>온체인 성공 · 서버 동기화 필요</strong>
            <p>{{ pendingSync.payload.txHash }}</p>
            <p v-if="pendingSync.additionalServerPendingCount">
              서버에 별도 진행 중인 민팅
              {{ pendingSync.additionalServerPendingCount }}건도 있습니다. 현재 브라우저에 저장된
              트랜잭션을 먼저 확인합니다.
            </p>
            <button type="button" :disabled="isChainActionRunning" @click="retryPendingSync">
              {{
                pendingSync.phase === 'submitted'
                  ? '기존 트랜잭션 확인 이어받기'
                  : pendingSync.type !== 'tokenized'
                    ? '서버 동기화 재시도'
                    : pendingSync.recoveredFromServerJournal && !pendingSync.serverRpcProof
                      ? '서버 검증 및 DB 동기화 재개'
                      : '민팅 결과 DB 동기화'
              }}
            </button>
          </div>
        </template>
        <p v-else-if="hasLoadedReceivables" class="empty">목록에서 채권을 선택하세요.</p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.receivables-page {
  min-height: 100%;
  padding: 32px;
  background: #f4f8f5;
  color: #15352b;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  max-width: 1180px;
  margin: 0 auto 24px;
}

.eyebrow {
  margin: 0 0 3px;
  color: #0b7654;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.09em;
}

h1 {
  margin: 0;
  color: #15352b;
  font-size: 32px;
  font-weight: 750;
  line-height: 1.25;
  letter-spacing: -0.02em;
}

h2 {
  margin-bottom: 18px;
  color: #15352b;
  font-size: 20px;
  font-weight: 750;
  line-height: 1.35;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.panel {
  max-width: 1180px;
  margin: 0 auto 20px;
  padding: 24px;
  border: 1px solid #dce5e0;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 6px 18px rgba(21, 53, 43, 0.04);
}

form,
label {
  display: grid;
  gap: 8px;
}

form {
  gap: 16px;
}

form > button {
  min-width: 150px;
  justify-self: start;
}

.two-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

label {
  color: #27463b;
  font-size: 14px;
  font-weight: 650;
}

input,
textarea {
  width: 100%;
  min-height: 44px;
  padding: 11px 12px;
  border: 1px solid #b8c7c0;
  border-radius: 9px;
  outline: none;
  background: #fbfdfc;
  color: #15352b;
  resize: vertical;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    background-color 0.16s ease;
}

input:hover,
textarea:hover {
  border-color: #8fa69b;
  background: #ffffff;
}

input:focus,
textarea:focus {
  border-color: #0b7654;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(11, 118, 84, 0.12);
}

button {
  min-height: 42px;
  border: 0;
  border-radius: 9px;
  padding: 11px 16px;
  background: #0b7654;
  color: white;
  cursor: pointer;
  font-weight: 700;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    box-shadow 0.16s ease,
    color 0.16s ease;
}

button:hover:not(:disabled) {
  background: #075f44;
}

button:focus-visible {
  outline: 3px solid rgba(11, 118, 84, 0.28);
  outline-offset: 2px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
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

.message {
  max-width: 1180px;
  margin: 0 auto 16px;
  padding: 12px 16px;
  border: 1px solid transparent;
  border-radius: 9px;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.55;
}

.message a {
  margin-left: 8px;
  color: inherit;
  font-weight: 700;
}

.error {
  border-color: #efc0c0;
  background: #fff0f0;
  color: #a32323;
}

.success {
  border-color: #afd8c7;
  background: #e8f7ef;
  color: #086245;
}

.pending,
.transaction {
  border-color: #bfd6eb;
  background: #eef5ff;
  color: #22558c;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr);
  align-items: start;
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
  align-items: center;
  gap: 16px;
  width: 100%;
  margin-top: 10px;
  padding: 14px 16px;
  border: 1px solid #e1e9e5;
  border-radius: 11px;
  text-align: left;
  background: #f4f8f5;
  color: #15352b;
}

.receivable-row:hover:not(:disabled) {
  border-color: #b8cfc3;
  background: #edf6f1;
}

.receivable-row.selected {
  border-color: #0b7654;
  outline: none;
  background: #eaf6ef;
  box-shadow: 0 0 0 1px rgba(11, 118, 84, 0.16);
}

.receivable-row.selected:hover:not(:disabled) {
  background: #e5f3eb;
}

.receivable-row span:first-child {
  display: grid;
  gap: 2px;
}

.receivable-row strong {
  font-weight: 750;
}

.receivable-row small {
  color: #62736b;
  line-height: 1.45;
}

.receivable-row .action-hint {
  margin-top: 4px;
  color: #0b7654;
  font-weight: 700;
}

.amount {
  white-space: nowrap;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}

.status {
  padding: 4px 8px;
  border-radius: 999px;
  background: #dff2e8;
  color: #0b7654;
  font-size: 12px;
  font-weight: 750;
  letter-spacing: 0.02em;
}

.empty {
  margin: 0;
  padding: 14px 16px;
  border: 1px solid #e1e9e5;
  border-radius: 10px;
  background: #f8fbf9;
  color: #788a82;
  line-height: 1.6;
}

.loading-state {
  color: #315548;
}

dl {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  column-gap: 18px;
  row-gap: 0;
  margin: 0;
}

dt {
  padding: 8px 0;
  border-bottom: 1px solid #edf1ef;
  color: #788a82;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.5;
}

dd {
  margin: 0;
  padding: 8px 0;
  border-bottom: 1px solid #edf1ef;
  color: #15352b;
  overflow-wrap: anywhere;
  line-height: 1.5;
}

.technical-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.chain-reference {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 8px;
}

.chain-reference span {
  flex: 1 1 180px;
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.explorer-button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 30px;
  padding: 5px 9px;
  border: 1px solid #0b7654;
  border-radius: 7px;
  background: white;
  color: #0b7654;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  text-decoration: none;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease;
}

.explorer-button:hover {
  border-color: #075f44;
  background: #eaf6ef;
  color: #075f44;
}

.explorer-button:focus-visible {
  outline: 3px solid rgba(11, 118, 84, 0.24);
  outline-offset: 2px;
}

.review-card {
  display: grid;
  gap: 14px;
  margin-top: 22px;
  padding: 18px;
  border: 1px solid #76ae96;
  border-radius: 12px;
  background: #f2faf6;
  box-shadow: 0 6px 16px rgba(21, 53, 43, 0.04);
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

.review-checklist li::marker {
  color: #0b7654;
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
  cursor: pointer;
  line-height: 1.5;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    background-color 0.16s ease;
}

.attestation:hover {
  border-color: #86ad9b;
  background: #fbfefc;
}

.attestation:focus-within {
  border-color: #0b7654;
  box-shadow: 0 0 0 3px rgba(11, 118, 84, 0.12);
}

.attestation input {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  padding: 0;
  accent-color: #0b7654;
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

.workflow-card > strong,
.sync-alert > strong {
  font-weight: 750;
}

.workflow-card p,
.sync-alert p {
  margin: 0;
  line-height: 1.55;
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

  .header-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .header-actions button {
    flex: 1 1 140px;
  }

  .panel {
    padding: 20px;
  }

  .two-columns,
  .content-grid {
    grid-template-columns: 1fr;
  }

  .receivable-row {
    grid-template-columns: 1fr;
  }

  dl {
    grid-template-columns: 88px minmax(0, 1fr);
    column-gap: 12px;
  }

  .review-actions {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 520px) {
  .receivables-page {
    padding: 20px 16px 32px;
  }

  .panel {
    padding: 18px;
  }

  form > button {
    width: 100%;
  }
}
</style>
