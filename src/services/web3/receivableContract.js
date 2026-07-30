import {
  Contract,
  getAddress,
  isAddress,
  isHexString,
  ZeroAddress,
  ZeroHash,
} from 'ethers'
import receivableFinanceAbi from '../../contracts/ReceivableFinance.abi.json'
import { giwaContractConfig } from '../../contracts/addresses'
import { normalizeWeb3Error, Web3Error } from './errors'
import { getGiwaSigner } from './provider'

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

async function confirmedTransaction(transaction) {
  try {
    const receipt = await transaction.wait()
    return {
      receipt: requireSuccessfulReceipt(receipt, transaction.hash),
      txHash: transaction.hash,
    }
  } catch (error) {
    if (
      error?.code === 'TRANSACTION_REPLACED' &&
      !error.cancelled &&
      error.receipt
    ) {
      const txHash =
        error.replacement?.hash ?? error.receipt.hash ?? transaction.hash
      return {
        receipt: requireSuccessfulReceipt(error.receipt, txHash),
        txHash,
      }
    }
    throw error
  }
}

function requireSuccessfulReceipt(receipt, txHash) {
  if (!receipt || receipt.status !== 1) {
    throw new Web3Error(
      'TRANSACTION_FAILED',
      '블록체인 트랜잭션이 실패했습니다.',
      { txHash },
    )
  }
  return receipt
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

function requireCreatedReceivableMatches(onchainReceivable, receivable) {
  const matches =
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

async function recoverReceipt(provider, txHash) {
  if (!isHexString(txHash, 32)) {
    throw new Web3Error(
      'INVALID_TRANSACTION_HASH',
      '저장된 트랜잭션 해시 형식을 확인할 수 없습니다.',
    )
  }

  const existingReceipt = await provider.getTransactionReceipt(txHash)
  const receipt =
    existingReceipt ??
    (await provider.waitForTransaction(txHash, 1, 60_000))
  if (!receipt) {
    throw new Web3Error(
      'TRANSACTION_NOT_CONFIRMED',
      '트랜잭션이 아직 확인되지 않았습니다. Explorer에서 상태를 확인한 뒤 다시 시도해 주세요.',
      { txHash },
    )
  }
  return requireSuccessfulReceipt(receipt, txHash)
}

export async function createReceivableOnchain(
  receivable,
  onSubmitted = () => {},
) {
  try {
    const { signer } = await getGiwaSigner(receivable.sellerWalletAddress)
    const address = contractAddress()
    const contract = new Contract(address, receivableFinanceAbi, signer)
    const transaction = await contract.createReceivable(
      receivable.buyerWalletAddress,
      positiveInteger(receivable.faceValue, '채권 금액'),
      positiveInteger(receivable.fundingAmount, '펀딩 요청 금액'),
      unixDate(receivable.issueDate, '발행일'),
      unixDate(receivable.maturityDate, '만기일'),
      documentHash(receivable.documentHash),
    )
    onSubmitted({
      contractAddress: address,
      txHash: transaction.hash,
    })
    const confirmation = await confirmedTransaction(transaction)
    return createdResult(
      confirmation.receipt,
      contract,
      receivable,
      confirmation.txHash,
      address,
    )
  } catch (error) {
    throw normalizeWeb3Error(error)
  }
}

export async function verifyReceivableOnchain(
  receivable,
  onSubmitted = () => {},
) {
  try {
    const address = contractAddress()
    requireStoredContractAddress(receivable, address)
    const { signer } = await getGiwaSigner(receivable.buyerWalletAddress)
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

    const transaction = await contract.verifyReceivable(receivableId)
    onSubmitted({ txHash: transaction.hash })
    const confirmation = await confirmedTransaction(transaction)
    return verifiedResult(
      confirmation.receipt,
      contract,
      receivable,
      confirmation.txHash,
    )
  } catch (error) {
    throw normalizeWeb3Error(error)
  }
}

export async function resumeReceivableTransaction(
  receivable,
  synchronization,
) {
  try {
    if (
      synchronization.type !== 'chain-created' &&
      synchronization.type !== 'verified'
    ) {
      throw new Web3Error(
        'INVALID_PENDING_TRANSACTION',
        '저장된 트랜잭션 종류를 확인할 수 없습니다.',
        { txHash: synchronization.payload?.txHash },
      )
    }
    const expectedWallet =
      synchronization.type === 'chain-created'
        ? receivable.sellerWalletAddress
        : receivable.buyerWalletAddress
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
    if (synchronization.type === 'verified') {
      requireStoredContractAddress(receivable, address)
    }

    const contract = new Contract(address, receivableFinanceAbi, signer)
    const txHash = synchronization.payload.txHash
    const receipt = await recoverReceipt(provider, txHash)
    if (synchronization.type === 'chain-created') {
      return createdResult(receipt, contract, receivable, txHash, address)
    }
    if (synchronization.type === 'verified') {
      return verifiedResult(receipt, contract, receivable, txHash)
    }
  } catch (error) {
    throw normalizeWeb3Error(error)
  }
}
