import { BrowserProvider, getAddress, isAddress } from 'ethers'
import { giwaContractConfig } from '../../contracts/addresses'
import { normalizeWeb3Error, Web3Error } from './errors'

export function getMetaMaskProvider() {
  const injectedProvider = window.ethereum
  if (!injectedProvider) return null

  const providers = injectedProvider.providers ?? [injectedProvider]
  return (
    providers.find(
      (provider) => provider.isMetaMask && !provider.isPhantom,
    ) ?? null
  )
}

export function requiredChainId() {
  if (!giwaContractConfig.chainId) {
    throw new Web3Error(
      'WEB3_NOT_CONFIGURED',
      'VITE_GIWA_CHAIN_ID 환경변수를 설정해 주세요.',
    )
  }

  try {
    const chainId = BigInt(giwaContractConfig.chainId)
    if (chainId <= 0n) throw new Error('Chain ID must be positive')
    return chainId
  } catch {
    throw new Web3Error(
      'WEB3_NOT_CONFIGURED',
      'VITE_GIWA_CHAIN_ID는 양의 정수여야 합니다.',
    )
  }
}

function configuredChainIdHex() {
  const chainId = requiredChainId()
  const derived = `0x${chainId.toString(16)}`
  const configured = giwaContractConfig.chainIdHex.toLowerCase()

  if (configured && !/^0x[0-9a-f]+$/.test(configured)) {
    throw new Web3Error(
      'WEB3_NOT_CONFIGURED',
      'VITE_GIWA_CHAIN_ID_HEX는 0x로 시작하는 16진수여야 합니다.',
    )
  }
  let configuredChainId
  try {
    configuredChainId = configured ? BigInt(configured) : chainId
  } catch {
    throw new Web3Error(
      'WEB3_NOT_CONFIGURED',
      'VITE_GIWA_CHAIN_ID_HEX는 0x로 시작하는 16진수여야 합니다.',
    )
  }
  if (configuredChainId !== chainId) {
    throw new Web3Error(
      'WEB3_NOT_CONFIGURED',
      'VITE_GIWA_CHAIN_ID와 VITE_GIWA_CHAIN_ID_HEX가 일치하지 않습니다.',
    )
  }
  return derived
}

export async function ensureGiwaNetwork(metaMaskProvider) {
  const expectedChainId = configuredChainIdHex()
  const currentChainId = String(
    await metaMaskProvider.request({ method: 'eth_chainId' }),
  ).toLowerCase()
  if (BigInt(currentChainId) === BigInt(expectedChainId)) return

  try {
    await metaMaskProvider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: expectedChainId }],
    })
    const switchedChainId = await metaMaskProvider.request({
      method: 'eth_chainId',
    })
    if (BigInt(switchedChainId) !== BigInt(expectedChainId)) {
      throw new Web3Error(
        'WRONG_NETWORK',
        `MetaMask 네트워크를 GIWA(Chain ID ${requiredChainId().toString()})로 전환해 주세요.`,
      )
    }
  } catch (error) {
    const code = error?.code ?? error?.info?.error?.code
    if (code === 4902) {
      throw new Web3Error(
        'WRONG_NETWORK',
        `MetaMask에 GIWA 네트워크(Chain ID ${requiredChainId().toString()})를 추가한 뒤 다시 시도해 주세요.`,
      )
    }
    throw normalizeWeb3Error(error)
  }
}

export async function getGiwaSigner(expectedWalletAddress) {
  const metaMaskProvider = getMetaMaskProvider()
  if (!metaMaskProvider) {
    throw new Web3Error(
      'METAMASK_NOT_INSTALLED',
      'MetaMask 확장 프로그램을 활성화한 뒤 페이지를 새로고침해 주세요.',
    )
  }
  if (!isAddress(expectedWalletAddress)) {
    throw new Web3Error(
      'WALLET_NOT_CONNECTED',
      '이 채권에 등록된 회사 지갑 주소를 확인할 수 없습니다.',
    )
  }

  try {
    await ensureGiwaNetwork(metaMaskProvider)
    const accounts = await metaMaskProvider.request({
      method: 'eth_requestAccounts',
    })
    if (!accounts?.length) {
      throw new Web3Error(
        'WALLET_NOT_CONNECTED',
        'MetaMask 계정을 연결해 주세요.',
      )
    }

    const provider = new BrowserProvider(metaMaskProvider)
    const signer = await provider.getSigner()
    const signerAddress = await signer.getAddress()
    if (getAddress(signerAddress) !== getAddress(expectedWalletAddress)) {
      throw new Web3Error(
        'WALLET_MISMATCH',
        `MetaMask 활성 계정을 이 채권의 등록 지갑(${expectedWalletAddress})으로 전환해 주세요.`,
      )
    }

    return { provider, signer, signerAddress }
  } catch (error) {
    throw normalizeWeb3Error(error)
  }
}
