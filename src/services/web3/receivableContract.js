import {
  Contract,
  getAddress,
  Interface,
  isAddress,
  isHexString,
  ZeroAddress,
  ZeroHash,
} from 'ethers'
import receivableFinanceAbi from '../../contracts/ReceivableFinance.abi.json'
import { giwaContractConfig } from '../../contracts/addresses'
import {
  confirmBlockchainTransaction,
  createPendingBlockchainTransaction,
  failBlockchainTransaction,
} from '../blockchainTransactions'
import { ApiError } from '../api'
import { normalizeWeb3Error, Web3Error } from './errors'
import { getGiwaSigner } from './provider'

const RECEIPT_TIMEOUT_MS = 60_000
const LEGACY_REPLACEMENT_LOOKBACK_BLOCKS = 128
const CREATE_RECEIVABLE = 'CREATE_RECEIVABLE'
const VERIFY_RECEIVABLE = 'VERIFY_RECEIVABLE'
const TOKENIZE_RECEIVABLE = 'TOKENIZE_RECEIVABLE'
const receivableFinanceInterface = new Interface(receivableFinanceAbi)

function normalizeContractFlowError(error) {
  return error instanceof ApiError ? error : normalizeWeb3Error(error)
}

function contractAddress() {
  const address = giwaContractConfig.receivableFinanceAddress
  if (!isAddress(address) || getAddress(address) === ZeroAddress) {
    throw new Web3Error(
      'CONTRACT_NOT_CONFIGURED',
      'VITE_RECEIVABLE_FINANCE_ADDRESS에 배포된 컨트랙트 주소를 설정해 주세요.',
    )
  }
  return getAddress(address)
}

function requireStoredContractAddress(receivable, configuredAddress) {
  if (
    !isAddress(receivable.contractAddress) ||
    getAddress(receivable.contractAddress) !== configuredAddress
  ) {
    throw new Web3Error(
      'CONTRACT_ADDRESS_MISMATCH',
      '이 채권을 생성한 컨트랙트와 현재 환경의 컨트랙트 주소가 다릅니다. 배포 설정을 확인해 주세요.',
    )
  }
}

function positiveInteger(value, fieldName) {
  const normalized = String(value)
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    throw new Web3Error(
      'INVALID_ONCHAIN_VALUE',
      `${fieldName} 값은 양의 정수여야 합니다.`,
    )
  }
  return BigInt(normalized)
}

function unixDate(dateValue, fieldName) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue ?? '')
  if (!match) {
    throw new Web3Error(
      'INVALID_ONCHAIN_VALUE',
      `${fieldName} 형식을 확인해 주세요.`,
    )
  }

  const timestamp = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  )
  return BigInt(Math.floor(timestamp / 1000))
}

function documentHash(value) {
  if (!value) return ZeroHash
  if (!isHexString(value, 32)) {
    throw new Web3Error(
      'INVALID_DOCUMENT_HASH',
      '문서 해시는 32바이트 SHA-256 형식이어야 합니다.',
    )
  }
  return value
}

function findEvent(receipt, contract, eventName) {
  const expectedAddress = getAddress(contract.target)
  for (const log of receipt.logs) {
    try {
      if (getAddress(log.address) !== expectedAddress) continue
      const parsed = contract.interface.parseLog(log)
      if (parsed?.name === eventName) return parsed
    } catch {
      // ERC-20/ERC-721 logs not represented by this interface are ignored.
    }
  }
  return null
}

function receiptMetadata(receipt) {
  const effectiveGasPrice =
    receipt.effectiveGasPrice ?? receipt.gasPrice
  if (
    receipt.blockNumber == null ||
    receipt.gasUsed == null ||
    effectiveGasPrice == null
  ) {
    throw new Web3Error(
      'INVALID_TRANSACTION_RECEIPT',
      '트랜잭션 영수증의 블록 또는 가스 정보를 확인할 수 없습니다.',
      { txHash: receipt.hash },
    )
  }

  return {
    blockNumber: String(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: effectiveGasPrice.toString(),
  }
}

function pendingTransactionPayload(tracking, txHash) {
  return {
    receivableId: tracking.receivableId,
    transactionType: tracking.transactionType,
    contractAddress: tracking.contractAddress,
    txHash,
  }
}

function failedJournalError(journal, txHash) {
  return new Web3Error(
    'BLOCKCHAIN_TRANSACTION_FAILED',
    journal.errorMessage ??
      '서버에 실패로 확정된 블록체인 트랜잭션입니다.',
    { txHash },
  )
}

function isDefinitiveTransactionFailure(error) {
  return (
    error?.code === 'TRANSACTION_FAILED' ||
    error?.code === 'TRANSACTION_CANCELLED' ||
    error?.code === 'BLOCKCHAIN_TRANSACTION_FAILED' ||
    error?.code === 'BLOCKCHAIN_TRANSACTION_REVERTED' ||
    error?.code ===
      'BLOCKCHAIN_TRANSACTION_VERIFICATION_FAILED' ||
    error?.code === 'BLOCKCHAIN_EVENT_MISMATCH'
  )
}

async function recordPendingTransaction(
  tracking,
  txHash,
  { allowFailed = false } = {},
) {
  const journal = await createPendingBlockchainTransaction(
    pendingTransactionPayload(tracking, txHash),
  )
  if (journal.txStatus === 'FAILED' && !allowFailed) {
    throw failedJournalError(journal, txHash)
  }
  return journal
}

async function recordConfirmedTransaction(txHash, receipt) {
  await confirmBlockchainTransaction(
    txHash,
    receiptMetadata(receipt),
  )
}

async function recordFailedTransaction(
  txHash,
  errorCode,
  errorMessage,
) {
  await failBlockchainTransaction(txHash, {
    errorCode,
    errorMessage,
  })
}

function transactionNotConfirmed(txHash) {
  return new Web3Error(
    'TRANSACTION_NOT_CONFIRMED',
    '트랜잭션이 아직 확인되지 않았습니다. Explorer에서 상태를 확인한 뒤 다시 시도해 주세요.',
    { txHash },
  )
}

async function confirmMinedReceipt(receipt, txHash) {
  if (!receipt) throw transactionNotConfirmed(txHash)
  if (receipt.status === 0) {
    await recordFailedTransaction(
      txHash,
      'TRANSACTION_FAILED',
      '블록체인에서 트랜잭션 실행이 실패했습니다.',
    )
    throw new Web3Error(
      'TRANSACTION_FAILED',
      '블록체인 트랜잭션이 실패했습니다.',
      { txHash },
    )
  }
  if (receipt.status !== 1) {
    throw new Web3Error(
      'INVALID_TRANSACTION_RECEIPT',
      '트랜잭션 영수증에서 실행 성공 여부를 확인할 수 없습니다.',
      { txHash },
    )
  }

  await recordConfirmedTransaction(txHash, receipt)
  return { receipt, txHash }
}

async function recordSubmittedTransaction(
  tracking,
  txHash,
  onSubmitted,
  extraPayload = {},
  transaction = null,
  fallbackProvider = null,
) {
  const transactionMetadata =
    serializableTransactionMetadata(transaction)
  let submittedPayload = {
    ...tracking.submittedPayload,
    ...extraPayload,
    ...(transactionMetadata ? { transactionMetadata } : {}),
    txHash,
  }
  await onSubmitted(submittedPayload)

  const provider = transaction?.provider ?? fallbackProvider
  if (
    normalizedBlockNumber(
      submittedPayload.replacementScanStartBlock,
    ) == null &&
    provider
  ) {
    const currentBlock = await safeCurrentBlockNumber(provider)
    if (currentBlock != null) {
      const replacementScanStartBlock = Math.max(0, currentBlock - 3)
      tracking.submittedPayload.replacementScanStartBlock =
        replacementScanStartBlock
      submittedPayload = {
        ...submittedPayload,
        replacementScanStartBlock,
      }
      await onSubmitted(submittedPayload)
    }
  }

  await recordPendingTransaction(tracking, txHash)
}

function normalizedBlockNumber(value) {
  if (value == null || value === '') return null
  const blockNumber = Number(value)
  return Number.isSafeInteger(blockNumber) && blockNumber >= 0
    ? blockNumber
    : null
}

function normalizedNonce(value) {
  if (value == null || value === '') return null
  const nonce = Number(value)
  return Number.isSafeInteger(nonce) && nonce >= 0 ? nonce : null
}

function normalizedAddress(value) {
  if (!isAddress(value)) return null
  return getAddress(value)
}

function normalizedTransactionData(value) {
  return typeof value === 'string' && isHexString(value)
    ? value.toLowerCase()
    : null
}

function normalizedTransactionValue(value) {
  try {
    const normalized = BigInt(value)
    return normalized >= 0n ? normalized.toString() : null
  } catch {
    return null
  }
}

function serializableTransactionMetadata(transaction) {
  if (!transaction) return null

  const from = normalizedAddress(transaction.from)
  const nonce = normalizedNonce(transaction.nonce)
  const to = normalizedAddress(transaction.to)
  const data = normalizedTransactionData(transaction.data)
  const value = normalizedTransactionValue(transaction.value)
  if (
    !from ||
    nonce == null ||
    !to ||
    !data ||
    value == null
  ) {
    return null
  }

  return { from, nonce, to, data, value }
}

async function safeCurrentBlockNumber(provider) {
  try {
    return normalizedBlockNumber(await provider.getBlockNumber())
  } catch {
    return null
  }
}

async function confirmReplacement(
  error,
  originalTxHash,
  tracking,
  onSubmitted,
  provider,
) {
  if (
    error?.code !== 'TRANSACTION_REPLACED' ||
    !error.receipt
  ) {
    return null
  }

  const replacementTxHash =
    error.replacement?.hash ?? error.receipt.hash
  if (!isHexString(replacementTxHash, 32)) {
    throw new Web3Error(
      'INVALID_TRANSACTION_HASH',
      '대체 트랜잭션 해시 형식을 확인할 수 없습니다.',
      { txHash: originalTxHash },
    )
  }

  if (error.cancelled) {
    await onSubmitted({
      ...tracking.submittedPayload,
      txHash: originalTxHash,
      replacementTxHash,
      transactionCancelled: true,
    })
    try {
      await recordFailedTransaction(
        originalTxHash,
        'TRANSACTION_REPLACED',
        '취소 트랜잭션이 기존 트랜잭션을 교체했습니다.',
      )
    } catch {
      throw new Web3Error(
        'TRANSACTION_CANCELLED_JOURNAL_PENDING',
        'MetaMask 트랜잭션은 취소되었지만 서버 실패 기록이 남아 있습니다. 재시도 버튼으로 정리해 주세요.',
        { txHash: originalTxHash },
      )
    }
    throw new Web3Error(
      'TRANSACTION_CANCELLED',
      'MetaMask에서 트랜잭션이 취소되었습니다.',
      { txHash: originalTxHash },
    )
  }

  await recordSubmittedTransaction(
    tracking,
    replacementTxHash,
    onSubmitted,
    {
      replacedTxHash: originalTxHash,
      replacementScanCursor: null,
    },
    error.replacement,
    provider,
  )

  let confirmation
  try {
    confirmation = await confirmMinedReceipt(
      error.receipt,
      replacementTxHash,
    )
  } catch (replacementError) {
    if (isDefinitiveTransactionFailure(replacementError)) {
      await recordFailedTransaction(
        originalTxHash,
        'TRANSACTION_REPLACED',
        '대체 트랜잭션이 기존 트랜잭션을 교체했습니다.',
      )
    }
    throw replacementError
  }
  await recordFailedTransaction(
    originalTxHash,
    'TRANSACTION_REPLACED',
    '대체 트랜잭션이 기존 트랜잭션을 교체했습니다.',
  )
  return confirmation
}

async function finalizeRecoveredReplacement(
  confirmation,
  recoveryPayload,
) {
  if (recoveryPayload.replacedTxHash) {
    await recordFailedTransaction(
      recoveryPayload.replacedTxHash,
      'TRANSACTION_REPLACED',
      '대체 트랜잭션이 기존 트랜잭션을 교체했습니다.',
    )
  }
  return confirmation
}

async function confirmedTransaction(
  transaction,
  tracking,
  onSubmitted,
) {
  if (!isHexString(transaction.hash, 32)) {
    throw new Web3Error(
      'INVALID_TRANSACTION_HASH',
      '제출된 트랜잭션 해시 형식을 확인할 수 없습니다.',
    )
  }
  const originalTxHash = transaction.hash
  await recordSubmittedTransaction(
    tracking,
    originalTxHash,
    onSubmitted,
    {},
    transaction,
  )

  try {
    const receipt = await transaction.wait(1, RECEIPT_TIMEOUT_MS)
    if (!receipt) throw transactionNotConfirmed(originalTxHash)
    return await confirmMinedReceipt(receipt, originalTxHash)
  } catch (error) {
    if (
      error?.code === 'TRANSACTION_REPLACED' &&
      error.receipt
    ) {
      return await confirmReplacement(
        error,
        originalTxHash,
        tracking,
        onSubmitted,
        transaction.provider,
      )
    }
    if (error?.code === 'TIMEOUT') {
      throw transactionNotConfirmed(originalTxHash)
    }
    if (
      error?.receipt &&
      error.receipt.status === 0
    ) {
      await recordFailedTransaction(
        originalTxHash,
        'TRANSACTION_FAILED',
        '블록체인에서 트랜잭션 실행이 실패했습니다.',
      )
      throw new Web3Error(
        'TRANSACTION_FAILED',
        '블록체인 트랜잭션이 실패했습니다.',
        { txHash: originalTxHash },
      )
    }
    if (error instanceof Web3Error) {
      throw error
    }
    throw error
  }
}

function normalizedStoredTransactionMetadata(value) {
  if (!value || typeof value !== 'object') return null

  const from = normalizedAddress(value.from)
  const nonce = normalizedNonce(value.nonce)
  const to = normalizedAddress(value.to)
  const data = normalizedTransactionData(value.data)
  const transactionValue = normalizedTransactionValue(value.value)
  if (
    !from ||
    nonce == null ||
    !to ||
    !data ||
    transactionValue == null
  ) {
    return null
  }

  return {
    from,
    nonce,
    to,
    data,
    value: transactionValue,
  }
}

function transactionIntentMatches(transaction, metadata) {
  const transactionMetadata =
    serializableTransactionMetadata(transaction)
  return (
    transactionMetadata &&
    transactionMetadata.from === metadata.from &&
    transactionMetadata.to === metadata.to &&
    transactionMetadata.data === metadata.data &&
    transactionMetadata.value === metadata.value
  )
}

function transactionHasSenderNonce(transaction, metadata) {
  return (
    normalizedAddress(transaction.from) === metadata.from &&
    normalizedNonce(transaction.nonce) === metadata.nonce
  )
}

async function scanTransactions(
  provider,
  startBlock,
  endBlock,
  matches,
) {
  const candidates = []
  const seenHashes = new Set()
  for (
    let blockNumber = startBlock;
    blockNumber <= endBlock;
    blockNumber += 1
  ) {
    const block = await provider.getBlock(blockNumber, true)
    if (!block) {
      throw new Web3Error(
        'TRANSACTION_REPLACEMENT_DISCOVERY_PENDING',
        `GIWA 블록 #${blockNumber}을 아직 조회할 수 없어 대체 트랜잭션 탐지를 중단했습니다. 잠시 후 다시 시도해 주세요.`,
      )
    }
    for (let index = 0; index < block.length; index += 1) {
      const transaction = await block.getTransaction(index)
      if (!transaction) continue
      if (
        !seenHashes.has(transaction.hash) &&
        matches(transaction)
      ) {
        seenHashes.add(transaction.hash)
        candidates.push(transaction)
      }
    }
  }
  return candidates
}

async function recoverMissingTransaction(
  provider,
  txHash,
  tracking,
  recoveryPayload,
  onSubmitted,
  latestBlock,
) {
  const storedMetadata = normalizedStoredTransactionMetadata(
    recoveryPayload.transactionMetadata,
  )
  const storedStartBlock = normalizedBlockNumber(
    recoveryPayload.replacementScanStartBlock,
  )
  const replacementScanStartBlock =
    storedStartBlock ??
    Math.max(
      0,
      latestBlock - LEGACY_REPLACEMENT_LOOKBACK_BLOCKS,
    )
  const storedCursor = normalizedBlockNumber(
    recoveryPayload.replacementScanCursor,
  )
  const replacementScanCursor =
    storedCursor ?? replacementScanStartBlock

  if (
    storedStartBlock !== replacementScanStartBlock ||
    storedCursor !== replacementScanCursor
  ) {
    await onSubmitted({
      ...tracking.submittedPayload,
      txHash,
      replacementScanStartBlock,
      replacementScanCursor,
    })
  }

  if (replacementScanCursor > latestBlock) {
    throw new Web3Error(
      'TRANSACTION_REPLACEMENT_DISCOVERY_PENDING',
      '새로 확인할 GIWA 블록이 아직 없습니다. 원본 또는 대체 트랜잭션이 채굴된 뒤 다시 시도해 주세요.',
      { txHash },
    )
  }

  const scanEndBlock = Math.min(
    latestBlock,
    replacementScanCursor +
      LEGACY_REPLACEMENT_LOOKBACK_BLOCKS -
      1,
  )
  const candidates = await scanTransactions(
    provider,
    replacementScanCursor,
    scanEndBlock,
    storedMetadata
      ? (transaction) =>
          transactionHasSenderNonce(transaction, storedMetadata)
      : (transaction) =>
          transactionIntentMatches(
            transaction,
            tracking.expectedTransaction,
          ),
  )

  if (candidates.length > 1) {
    throw new Web3Error(
      'TRANSACTION_REPLACEMENT_DISCOVERY_PENDING',
      '대체 트랜잭션 후보가 여러 개라 안전하게 확정할 수 없습니다. Explorer에서 원본 해시를 확인해 주세요.',
      { txHash },
    )
  }
  if (!candidates.length) {
    await onSubmitted({
      ...tracking.submittedPayload,
      txHash,
      replacementScanStartBlock,
      replacementScanCursor: scanEndBlock + 1,
    })
    throw new Web3Error(
      'TRANSACTION_REPLACEMENT_DISCOVERY_PENDING',
      scanEndBlock < latestBlock
        ? '대체 트랜잭션 탐색 범위를 저장했습니다. 다음 블록 범위를 이어서 확인하려면 다시 시도해 주세요.'
        : '원본 또는 대체 트랜잭션이 아직 확인되지 않았습니다. 잠시 후 다시 시도해 주세요.',
      { txHash },
    )
  }

  const candidate = candidates[0]
  const receipt = await provider.getTransactionReceipt(candidate.hash)
  if (!receipt) {
    throw transactionNotConfirmed(candidate.hash)
  }
  if (candidate.hash.toLowerCase() === txHash.toLowerCase()) {
    return await confirmMinedReceipt(receipt, txHash)
  }

  const sameIntent = storedMetadata
    ? transactionIntentMatches(candidate, storedMetadata)
    : true
  return await confirmReplacement(
    {
      code: 'TRANSACTION_REPLACED',
      cancelled: !sameIntent,
      reason: sameIntent ? 'repriced' : 'replaced',
      replacement: candidate,
      receipt,
    },
    txHash,
    tracking,
    onSubmitted,
    provider,
  )
}

async function recoverTrackedReceipt(
  provider,
  txHash,
  tracking,
  recoveryPayload,
  onSubmitted,
) {
  if (!isHexString(txHash, 32)) {
    throw new Web3Error(
      'INVALID_TRANSACTION_HASH',
      '저장된 트랜잭션 해시 형식을 확인할 수 없습니다.',
    )
  }

  const journal = await recordPendingTransaction(
    tracking,
    txHash,
    { allowFailed: true },
  )
  if (journal.txStatus === 'FAILED') {
    await finalizeRecoveredReplacement(null, recoveryPayload)
    throw failedJournalError(journal, txHash)
  }

  try {
    const existingReceipt =
      await provider.getTransactionReceipt(txHash)
    if (existingReceipt) {
      const confirmation = await confirmMinedReceipt(
        existingReceipt,
        txHash,
      )
      return await finalizeRecoveredReplacement(
        confirmation,
        recoveryPayload,
      )
    }

    const transaction = await provider.getTransaction(txHash)
    const latestBlock = normalizedBlockNumber(
      await provider.getBlockNumber(),
    )
    if (latestBlock == null) {
      throw new Web3Error(
        'INVALID_BLOCK_NUMBER',
        '현재 GIWA 블록 번호를 확인할 수 없습니다.',
        { txHash },
      )
    }
    if (!transaction) {
      const confirmation = await recoverMissingTransaction(
        provider,
        txHash,
        tracking,
        recoveryPayload,
        onSubmitted,
        latestBlock,
      )
      return await finalizeRecoveredReplacement(
        confirmation,
        recoveryPayload,
      )
    }

    const storedStartBlock = normalizedBlockNumber(
      recoveryPayload.replacementScanStartBlock,
    )
    const replacementScanStartBlock = Math.min(
      storedStartBlock ??
        Math.max(
          0,
          latestBlock - LEGACY_REPLACEMENT_LOOKBACK_BLOCKS,
        ),
      latestBlock,
    )
    tracking.submittedPayload.replacementScanStartBlock =
      replacementScanStartBlock
    const transactionMetadata =
      serializableTransactionMetadata(transaction)
    const hasStoredTransactionMetadata =
      normalizedStoredTransactionMetadata(
        recoveryPayload.transactionMetadata,
      ) != null
    if (
      storedStartBlock !== replacementScanStartBlock ||
      (!hasStoredTransactionMetadata && transactionMetadata)
    ) {
      await onSubmitted({
        ...tracking.submittedPayload,
        txHash,
        replacementScanStartBlock,
        ...(transactionMetadata ? { transactionMetadata } : {}),
      })
    }

    const receipt = await transaction
      .replaceableTransaction(replacementScanStartBlock)
      .wait(1, RECEIPT_TIMEOUT_MS)
    if (!receipt) throw transactionNotConfirmed(txHash)
    const confirmation = await confirmMinedReceipt(receipt, txHash)
    return await finalizeRecoveredReplacement(
      confirmation,
      recoveryPayload,
    )
  } catch (error) {
    if (
      error?.code === 'TRANSACTION_REPLACED' &&
      error.receipt
    ) {
      try {
        const confirmation = await confirmReplacement(
          error,
          txHash,
          tracking,
          onSubmitted,
          provider,
        )
        return await finalizeRecoveredReplacement(
          confirmation,
          recoveryPayload,
        )
      } catch (replacementError) {
        if (isDefinitiveTransactionFailure(replacementError)) {
          await finalizeRecoveredReplacement(null, recoveryPayload)
        }
        throw replacementError
      }
    }
    if (error?.code === 'TIMEOUT') {
      throw transactionNotConfirmed(txHash)
    }
    if (isDefinitiveTransactionFailure(error)) {
      await finalizeRecoveredReplacement(null, recoveryPayload)
      throw error
    }
    if (error instanceof Web3Error) {
      throw error
    }
    if (
      error?.receipt &&
      error.receipt.status === 0
    ) {
      await recordFailedTransaction(
        txHash,
        'TRANSACTION_FAILED',
        '블록체인에서 트랜잭션 실행이 실패했습니다.',
      )
      await finalizeRecoveredReplacement(null, recoveryPayload)
      throw new Web3Error(
        'TRANSACTION_FAILED',
        '블록체인 트랜잭션이 실패했습니다.',
        { txHash },
      )
    }
    throw error
  }
}

function expectedTransactionMetadata(
  receivable,
  transactionType,
  address,
) {
  let from
  let data
  if (transactionType === CREATE_RECEIVABLE) {
    from = getAddress(receivable.sellerWalletAddress)
    data = receivableFinanceInterface.encodeFunctionData(
      'createReceivable',
      [
        receivable.buyerWalletAddress,
        positiveInteger(receivable.faceValue, '채권 금액'),
        positiveInteger(receivable.fundingAmount, '펀딩 요청 금액'),
        unixDate(receivable.issueDate, '발행일'),
        unixDate(receivable.maturityDate, '만기일'),
        documentHash(receivable.documentHash),
      ],
    )
  } else if (transactionType === VERIFY_RECEIVABLE) {
    from = getAddress(receivable.buyerWalletAddress)
    data = receivableFinanceInterface.encodeFunctionData(
      'verifyReceivable',
      [
        positiveInteger(
          receivable.onchainReceivableId,
          '온체인 채권 ID',
        ),
      ],
    )
  } else if (transactionType === TOKENIZE_RECEIVABLE) {
    from = getAddress(receivable.sellerWalletAddress)
    data = receivableFinanceInterface.encodeFunctionData(
      'tokenizeReceivable',
      [
        positiveInteger(
          receivable.onchainReceivableId,
          '온체인 채권 ID',
        ),
      ],
    )
  } else {
    throw new Web3Error(
      'INVALID_PENDING_TRANSACTION',
      '블록체인 트랜잭션 종류를 확인할 수 없습니다.',
    )
  }

  return {
    from,
    to: address,
    data: data.toLowerCase(),
    value: '0',
  }
}

function transactionTracking(
  receivable,
  transactionType,
  address,
  replacementScanStartBlock = null,
) {
  const submittedPayload =
    transactionType === CREATE_RECEIVABLE
      ? { contractAddress: address }
      : {}
  const normalizedStartBlock = normalizedBlockNumber(
    replacementScanStartBlock,
  )
  if (normalizedStartBlock != null) {
    submittedPayload.replacementScanStartBlock =
      normalizedStartBlock
  }

  return {
    receivableId: receivable.receivableId,
    transactionType,
    contractAddress: address,
    expectedTransaction: expectedTransactionMetadata(
      receivable,
      transactionType,
      address,
    ),
    submittedPayload,
  }
}

function trackingForSynchronization(
  receivable,
  synchronization,
  address,
) {
  if (synchronization.type === 'chain-created') {
    return transactionTracking(
      receivable,
      CREATE_RECEIVABLE,
      address,
    )
  }
  if (synchronization.type === 'verified') {
    return transactionTracking(
      receivable,
      VERIFY_RECEIVABLE,
      address,
    )
  }
  if (synchronization.type === 'tokenized') {
    return transactionTracking(
      receivable,
      TOKENIZE_RECEIVABLE,
      address,
    )
  }
  throw new Web3Error(
    'INVALID_PENDING_TRANSACTION',
    '저장된 트랜잭션 종류를 확인할 수 없습니다.',
    { txHash: synchronization.payload?.txHash },
  )
}

function createdResult(receipt, contract, receivable, txHash, address) {
  const event = findEvent(receipt, contract, 'ReceivableCreated')
  if (
    !event ||
    getAddress(event.args.seller) !==
      getAddress(receivable.sellerWalletAddress) ||
    getAddress(event.args.buyer) !==
      getAddress(receivable.buyerWalletAddress) ||
    event.args.faceValue !==
      positiveInteger(receivable.faceValue, '채권 금액') ||
    event.args.fundingAmount !==
      positiveInteger(receivable.fundingAmount, '펀딩 요청 금액') ||
    event.args.issueDate !== unixDate(receivable.issueDate, '발행일') ||
    event.args.maturityDate !==
      unixDate(receivable.maturityDate, '만기일') ||
    event.args.documentHash.toLowerCase() !==
      documentHash(receivable.documentHash).toLowerCase()
  ) {
    throw new Web3Error(
      'CONTRACT_EVENT_NOT_FOUND',
      '트랜잭션은 확인되었지만 대상 ReceivableCreated 이벤트를 찾지 못했습니다.',
      { txHash },
    )
  }

  return {
    onchainReceivableId: event.args.receivableId.toString(),
    contractAddress: address,
    txHash,
  }
}

function verifiedResult(receipt, contract, receivable, txHash) {
  const event = findEvent(receipt, contract, 'ReceivableVerified')
  if (
    !event ||
    event.args.receivableId.toString() !==
      String(receivable.onchainReceivableId) ||
    getAddress(event.args.buyer) !== getAddress(receivable.buyerWalletAddress)
  ) {
    throw new Web3Error(
      'CONTRACT_EVENT_NOT_FOUND',
      '트랜잭션은 확인되었지만 대상 ReceivableVerified 이벤트를 찾지 못했습니다.',
      { txHash },
    )
  }

  return { txHash }
}

function tokenizedResult(
  receipt,
  contract,
  receivable,
  txHash,
  address,
) {
  const event = findEvent(receipt, contract, 'ReceivableTokenized')
  if (
    !event ||
    event.args.receivableId.toString() !==
      String(receivable.onchainReceivableId) ||
    event.args.tokenId <= 0n ||
    getAddress(event.args.custodian) !== address
  ) {
    throw new Web3Error(
      'CONTRACT_EVENT_NOT_FOUND',
      '트랜잭션은 확인되었지만 대상 ReceivableTokenized 이벤트를 찾지 못했습니다.',
      { txHash },
    )
  }

  return {
    tokenId: event.args.tokenId.toString(),
    txHash,
  }
}

function receivableTermsMatch(onchainReceivable, receivable) {
  return (
    onchainReceivable.id.toString() ===
      String(receivable.onchainReceivableId) &&
    getAddress(onchainReceivable.seller) ===
      getAddress(receivable.sellerWalletAddress) &&
    getAddress(onchainReceivable.buyer) ===
      getAddress(receivable.buyerWalletAddress) &&
    onchainReceivable.faceValue ===
      positiveInteger(receivable.faceValue, '채권 금액') &&
    onchainReceivable.fundingAmount ===
      positiveInteger(receivable.fundingAmount, '펀딩 요청 금액') &&
    onchainReceivable.issueDate ===
      unixDate(receivable.issueDate, '발행일') &&
    onchainReceivable.maturityDate ===
      unixDate(receivable.maturityDate, '만기일') &&
    onchainReceivable.documentHash.toLowerCase() ===
      documentHash(receivable.documentHash).toLowerCase()
  )
}

function requireCreatedReceivableMatches(onchainReceivable, receivable) {
  const matches =
    receivableTermsMatch(onchainReceivable, receivable)

  if (!matches) {
    throw new Web3Error(
      'ONCHAIN_RECEIVABLE_MISMATCH',
      '화면의 채권 정보와 GIWA에 등록된 채권 정보가 일치하지 않아 검증을 중단했습니다.',
    )
  }
  if (onchainReceivable.status !== 0n) {
    throw new Web3Error(
      'ONCHAIN_RECEIVABLE_NOT_CREATED',
      'GIWA 채권이 Buyer 검증 가능한 CREATED 상태가 아닙니다. 화면을 새로고침해 주세요.',
    )
  }
}

function requireVerifiedReceivableMatches(onchainReceivable, receivable) {
  if (!receivableTermsMatch(onchainReceivable, receivable)) {
    throw new Web3Error(
      'ONCHAIN_RECEIVABLE_MISMATCH',
      '화면의 채권 정보와 GIWA에 등록된 채권 정보가 일치하지 않아 토큰화를 중단했습니다.',
    )
  }
  if (onchainReceivable.status !== 1n) {
    throw new Web3Error(
      'ONCHAIN_RECEIVABLE_NOT_VERIFIED',
      'GIWA 채권이 Seller 토큰화 가능한 VERIFIED 상태가 아닙니다. 화면을 새로고침해 주세요.',
    )
  }
}

export async function createReceivableOnchain(
  receivable,
  onSubmitted = () => {},
) {
  try {
    const { provider, signer } = await getGiwaSigner(
      receivable.sellerWalletAddress,
    )
    const address = contractAddress()
    const contract = new Contract(address, receivableFinanceAbi, signer)
    const replacementScanStartBlock =
      await safeCurrentBlockNumber(provider)
    const tracking = transactionTracking(
      receivable,
      CREATE_RECEIVABLE,
      address,
      replacementScanStartBlock,
    )
    const transaction = await contract.createReceivable(
      receivable.buyerWalletAddress,
      positiveInteger(receivable.faceValue, '채권 금액'),
      positiveInteger(receivable.fundingAmount, '펀딩 요청 금액'),
      unixDate(receivable.issueDate, '발행일'),
      unixDate(receivable.maturityDate, '만기일'),
      documentHash(receivable.documentHash),
    )
    const confirmation = await confirmedTransaction(
      transaction,
      tracking,
      onSubmitted,
    )
    return createdResult(
      confirmation.receipt,
      contract,
      receivable,
      confirmation.txHash,
      address,
    )
  } catch (error) {
    throw normalizeContractFlowError(error)
  }
}

export async function verifyReceivableOnchain(
  receivable,
  onSubmitted = () => {},
) {
  try {
    const address = contractAddress()
    requireStoredContractAddress(receivable, address)
    const { provider, signer } = await getGiwaSigner(
      receivable.buyerWalletAddress,
    )
    const contract = new Contract(
      address,
      receivableFinanceAbi,
      signer,
    )
    const receivableId = positiveInteger(
      receivable.onchainReceivableId,
      '온체인 채권 ID',
    )
    const onchainReceivable = await contract.getReceivable(receivableId)
    requireCreatedReceivableMatches(onchainReceivable, receivable)

    const replacementScanStartBlock =
      await safeCurrentBlockNumber(provider)
    const tracking = transactionTracking(
      receivable,
      VERIFY_RECEIVABLE,
      address,
      replacementScanStartBlock,
    )
    const transaction = await contract.verifyReceivable(receivableId)
    const confirmation = await confirmedTransaction(
      transaction,
      tracking,
      onSubmitted,
    )
    return verifiedResult(
      confirmation.receipt,
      contract,
      receivable,
      confirmation.txHash,
    )
  } catch (error) {
    throw normalizeContractFlowError(error)
  }
}

export async function tokenizeReceivableOnchain(
  receivable,
  onSubmitted = () => {},
) {
  try {
    const address = contractAddress()
    requireStoredContractAddress(receivable, address)
    const { provider, signer } = await getGiwaSigner(
      receivable.sellerWalletAddress,
    )
    const contract = new Contract(
      address,
      receivableFinanceAbi,
      signer,
    )
    const receivableId = positiveInteger(
      receivable.onchainReceivableId,
      '온체인 채권 ID',
    )
    const onchainReceivable = await contract.getReceivable(receivableId)
    requireVerifiedReceivableMatches(onchainReceivable, receivable)

    const replacementScanStartBlock =
      await safeCurrentBlockNumber(provider)
    const tracking = transactionTracking(
      receivable,
      TOKENIZE_RECEIVABLE,
      address,
      replacementScanStartBlock,
    )
    const transaction = await contract.tokenizeReceivable(receivableId)
    const confirmation = await confirmedTransaction(
      transaction,
      tracking,
      onSubmitted,
    )
    return tokenizedResult(
      confirmation.receipt,
      contract,
      receivable,
      confirmation.txHash,
      address,
    )
  } catch (error) {
    throw normalizeContractFlowError(error)
  }
}

export async function resumeReceivableTransaction(
  receivable,
  synchronization,
  onSubmitted = () => {},
) {
  try {
    if (synchronization.payload.transactionCancelled) {
      const txHash = synchronization.payload.txHash
      await recordFailedTransaction(
        txHash,
        'TRANSACTION_REPLACED',
        '취소 트랜잭션이 기존 트랜잭션을 교체했습니다.',
      )
      await finalizeRecoveredReplacement(
        null,
        synchronization.payload,
      )
      throw new Web3Error(
        'TRANSACTION_CANCELLED',
        'MetaMask에서 트랜잭션이 취소되었습니다.',
        { txHash },
      )
    }
    if (
      synchronization.type !== 'chain-created' &&
      synchronization.type !== 'verified' &&
      synchronization.type !== 'tokenized'
    ) {
      throw new Web3Error(
        'INVALID_PENDING_TRANSACTION',
        '저장된 트랜잭션 종류를 확인할 수 없습니다.',
        { txHash: synchronization.payload?.txHash },
      )
    }
    const expectedWallet =
      synchronization.type === 'verified'
        ? receivable.buyerWalletAddress
        : receivable.sellerWalletAddress
    const { provider, signer } = await getGiwaSigner(expectedWallet)
    const address = contractAddress()
    if (
      synchronization.payload.contractAddress &&
      getAddress(synchronization.payload.contractAddress) !== address
    ) {
      throw new Web3Error(
        'CONTRACT_ADDRESS_MISMATCH',
        '저장된 트랜잭션과 현재 환경의 컨트랙트 주소가 다릅니다.',
      )
    }
    if (synchronization.type !== 'chain-created') {
      requireStoredContractAddress(receivable, address)
    }

    const contract = new Contract(address, receivableFinanceAbi, signer)
    const txHash = synchronization.payload.txHash
    const confirmation = await recoverTrackedReceipt(
      provider,
      txHash,
      trackingForSynchronization(
        receivable,
        synchronization,
        address,
      ),
      synchronization.payload,
      onSubmitted,
    )
    if (synchronization.type === 'chain-created') {
      return createdResult(
        confirmation.receipt,
        contract,
        receivable,
        confirmation.txHash,
        address,
      )
    }
    if (synchronization.type === 'verified') {
      return verifiedResult(
        confirmation.receipt,
        contract,
        receivable,
        confirmation.txHash,
      )
    }
    if (synchronization.type === 'tokenized') {
      return tokenizedResult(
        confirmation.receipt,
        contract,
        receivable,
        confirmation.txHash,
        address,
      )
    }
  } catch (error) {
    throw normalizeContractFlowError(error)
  }
}
