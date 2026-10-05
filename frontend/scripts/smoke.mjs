// End-to-end smoke test against a deployed AgentArbiter.
// Prints every transaction hash, including the settle tx that runs the
// leader/validator adjudication through GenLayer consensus.
// Usage: [NETWORK=studionext|localnet] node scripts/smoke.mjs <contractAddress>
import { makeAccount, makeClient, fund as fundAccount, explorerTx, NETWORK } from './lib.mjs'

const CONTRACT = process.argv[2]
if (!CONTRACT) {
  console.error('Usage: node scripts/smoke.mjs <contractAddress>')
  process.exit(1)
}

const log = (label, value) => console.log(`\n[${label}]`, value)

async function fund(client, address) {
  if (!(await fundAccount(client, address, 100))) {
    throw new Error(`Could not fund ${address} on ${NETWORK.name}`)
  }
}

async function main() {
  // Three parties: requester (alice), worker (bob), observer (charlie).
  const alice = makeAccount()
  const bob = makeAccount()
  const charlie = makeAccount()

  const aliceClient = makeClient(alice)
  const bobClient = makeClient(bob)
  const charlieClient = makeClient(charlie)
  log('network', `${NETWORK.name} (chain ${NETWORK.id})`)

  await fund(aliceClient, alice.address)
  await fund(bobClient, bob.address)
  await fund(charlieClient, charlie.address)
  log('funded', 'alice, bob, charlie')

  const reward = 1000000000000000000n // 1 GEN

  // Unique id so the smoke test can be re-run against the same contract.
  const TASK_ID = `smoke-${Date.now()}`

  // 1. alice creates a task
  const createTx = await aliceClient.writeContract({
    address: CONTRACT,
    functionName: 'create_task',
    args: [TASK_ID, 'Write a 2-sentence summary of GenLayer', 'Summary is 2 sentences and mentions GenLayer', '2099-01-01T00:00:00Z'],
    value: reward,
  })
  await aliceClient.waitForTransactionReceipt({ hash: createTx, status: 'FINALIZED' })
  log('create_task', createTx)

  let task = await aliceClient.readContract({
    address: CONTRACT,
    functionName: 'get_task',
    args: [TASK_ID],
  })
  log('task after create', task)
  if (task.status !== 'CREATED') throw new Error('Expected CREATED')

  // 2. bob accepts (stakes equal reward)
  const acceptTx = await bobClient.writeContract({
    address: CONTRACT,
    functionName: 'accept_task',
    args: [TASK_ID],
    value: reward,
  })
  await bobClient.waitForTransactionReceipt({ hash: acceptTx, status: 'FINALIZED' })
  log('accept_task', acceptTx)

  // 3. bob submits work
  const submitTx = await bobClient.writeContract({
    address: CONTRACT,
    functionName: 'submit_work',
    args: [TASK_ID, 'Summary of GenLayer delivered at https://example.com/summary'],
    value: 0n,
  })
  await bobClient.waitForTransactionReceipt({ hash: submitTx, status: 'FINALIZED' })
  log('submit_work', submitTx)

  // 4. charlie (anyone) settles — runs AI adjudication
  const settleTx = await charlieClient.writeContract({
    address: CONTRACT,
    functionName: 'settle',
    args: [TASK_ID],
    value: 0n,
  })
  await charlieClient.waitForTransactionReceipt({
    hash: settleTx,
    status: 'FINALIZED',
  })
  log('settle', explorerTx(settleTx))

  task = await charlieClient.readContract({
    address: CONTRACT,
    functionName: 'get_task',
    args: [TASK_ID],
  })
  log('task after settle', task)

  if (task.status !== 'SETTLED') throw new Error('Expected SETTLED')
  if (!['APPROVED', 'REJECTED', 'UNDETERMINED'].includes(task.outcome)) {
    throw new Error('Unexpected outcome: ' + task.outcome)
  }

  console.log('\n=== SMOKE TEST PASSED ===')
  console.log('Final outcome:', task.outcome)
  console.log('Validator reasoning:', task.reasoning)
  console.log('Settle tx (consensus adjudication):', explorerTx(settleTx))
}

main().catch((e) => {
  console.error('Smoke test failed:', e)
  process.exit(1)
})
