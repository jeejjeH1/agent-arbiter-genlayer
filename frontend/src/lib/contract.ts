import { getSession, getContractAddress } from './genlayer'
import type { ExecutionResult } from 'genlayer-js/types'

export type TaskStatus = 'CREATED' | 'ASSIGNED' | 'SUBMITTED' | 'SETTLED' | 'CANCELLED'
export type Outcome = 'APPROVED' | 'REJECTED' | 'UNDETERMINED' | ''

export interface Task {
  id: string
  spec: string
  criteria: string
  deadline: string
  amount: string
  requester: string
  worker: string
  status: TaskStatus
  evidence: string
  outcome: Outcome
  reasoning: string
}

interface RawTask {
  id: string
  spec: string
  criteria: string
  deadline: string
  amount: string | number | bigint
  requester: string
  worker: string
  status: TaskStatus
  evidence: string
  outcome: Outcome
  reasoning: string
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

export async function fetchTasks(): Promise<Task[]> {
  const { client } = getSession()
  const address = getContractAddress()

  const ids = (await client.readContract({
    address: address as `0x${string}`,
    functionName: 'get_task_ids',
    args: [],
  })) as string[]

  const tasks: Task[] = []
  for (const id of ids) {
    const raw = (await client.readContract({
      address: address as `0x${string}`,
      functionName: 'get_task',
      args: [id],
    })) as unknown as RawTask
    tasks.push(normalize(raw))
  }
  return tasks.sort((a, b) => a.id.localeCompare(b.id))
}

export async function fetchTask(id: string): Promise<Task> {
  const { client } = getSession()
  const address = getContractAddress()
  const raw = (await client.readContract({
    address: address as `0x${string}`,
    functionName: 'get_task',
    args: [id],
  })) as unknown as RawTask
  return normalize(raw)
}

function normalize(raw: RawTask): Task {
  return {
    ...raw,
    amount: raw.amount?.toString() ?? '0',
    worker: raw.worker ?? ZERO_ADDR,
  }
}

// Burner accounts start empty. Localnet and Studio Next expose
// sim_fundAccount, so top the account up once per session before the first
// payable call. Bradbury needs the faucet instead.
let fundAttempted = false
async function ensureFunded(): Promise<void> {
  if (fundAttempted) return
  fundAttempted = true
  const { client, address, network } = getSession()
  if (network === 'testnet') return
  try {
    await fetch(client.chain.rpcUrls.default.http[0], {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sim_fundAccount',
        params: [address, 100 * 10 ** 18],
      }),
    })
  } catch {
    /* network may not support funding; the write will surface any balance error */
  }
}

// GenLayer transactions carry a fee distribution; genlayer-js derives the
// caps from the network's active fee policy.
async function send(functionName: string, args: any[], value: bigint): Promise<string> {
  const { client } = getSession()
  const fees = await (client as any).estimateTransactionFees({})
  const hash = await client.writeContract({
    address: getContractAddress() as `0x${string}`,
    functionName,
    args,
    value,
    fees,
  } as any)
  await waitForResult(hash)
  return hash
}

async function waitForResult(hash: string): Promise<void> {
  const { client } = getSession()
  const receipt = await client.waitForTransactionReceipt({
    hash: hash as any,
  })
  const result = (receipt as any).txExecutionResultName as ExecutionResult | undefined
  if (result === 'FINISHED_WITH_ERROR') {
    throw new Error('Transaction reverted by the contract')
  }
}

export async function createTask(params: {
  id: string
  spec: string
  criteria: string
  deadline: string
  rewardWei: bigint
}): Promise<string> {
  await ensureFunded()
  return send('create_task', [params.id, params.spec, params.criteria, params.deadline], params.rewardWei)
}

export async function acceptTask(id: string, stakeWei: bigint): Promise<string> {
  await ensureFunded()
  return send('accept_task', [id], stakeWei)
}

export async function submitWork(id: string, evidence: string): Promise<string> {
  return send('submit_work', [id, evidence], 0n)
}

export async function settle(id: string): Promise<string> {
  return send('settle', [id], 0n)
}

export async function refundUnaccepted(id: string): Promise<string> {
  return send('refund_unaccepted', [id], 0n)
}
