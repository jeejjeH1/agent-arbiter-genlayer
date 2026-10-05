// Shared client helpers for the deploy/smoke scripts and the autonomous agents.
//
// Select the network with NETWORK=studionext | localnet | testnet
// (default: studionext). Burner accounts are funded via sim_fundAccount on
// localnet/Studio; pass funded keys (PRIVATE_KEY, REQUESTER_KEY, WORKER_KEY)
// to reuse an existing account.
import { createClient, createAccount, generatePrivateKey } from 'genlayer-js'
import { localnet, studionet, testnetBradbury } from 'genlayer-js/chains'

// GenLayer Studio Next (chain 61997). genlayer-js 1.x only ships the older
// studionet preset (61999, studio.genlayer.com), so define it explicitly.
export const studioNext = {
  ...studionet,
  id: 61997,
  name: 'GenLayer Studio Next',
  rpcUrls: { default: { http: ['https://studio-dev.genlayer.com/api'] } },
  blockExplorers: {
    default: { name: 'Studio Next Explorer', url: 'https://explorer-studio-dev.genlayer.com' },
  },
}

const NETWORKS = { studionext: studioNext, localnet, testnet: testnetBradbury }
export const NETWORK_ID = process.env.NETWORK || 'studionext'
export const NETWORK = NETWORKS[NETWORK_ID]
if (!NETWORK) {
  throw new Error(`Unknown NETWORK=${NETWORK_ID} (use studionext | localnet | testnet)`)
}

export function makeAccount(key) {
  return createAccount(key || generatePrivateKey())
}

export function makeClient(account) {
  return createClient({ chain: NETWORK, account })
}

export function explorerTx(hash) {
  const url = NETWORK.blockExplorers?.default?.url
  return url ? `${url.replace(/\/$/, '')}/tx/${hash}` : hash
}

export async function fund(client, address, gen = 100) {
  // Localnet and Studio expose sim_fundAccount; Bradbury needs the faucet.
  if (NETWORK.id === testnetBradbury.id) return false
  try {
    await client.fundAccount({ address, amount: Number(BigInt(gen) * 10n ** 18n) })
    return true
  } catch {
    return false
  }
}

export async function write(client, contract, functionName, args, value = 0n) {
  const hash = await client.writeContract({
    address: contract,
    functionName,
    args,
    value,
  })
  const receipt = await client.waitForTransactionReceipt({ hash, status: 'FINALIZED' })
  return { hash, receipt }
}

export async function read(client, contract, functionName, args = []) {
  return client.readContract({ address: contract, functionName, args })
}
