import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { type Address, decodeFunctionData, type Hex, pad, parseAbi, zeroHash } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { erc20Abi } from '../abi/erc20'
import { FORWARD_HOOK_DATA, TOKEN_MESSENGER_V2, TOKENS } from '../config'
import type { Sender, TxResult } from '../lib/sender'
import { AccountWithdraw } from './AccountWithdraw'

const ACCOUNT = '0x00000000000000000000000000000000000000cC' as Address
const FRIEND = '0x1111111111111111111111111111111111111111'
const HASH = `0x${'1'.repeat(64)}` as Hex

const balances = vi.hoisted(() => ({ usdc: 0n, eurc: 0n }))
const fetchAccountBalances = vi.hoisted(() => vi.fn(async () => ({ ...balances })))
vi.mock('../lib/deposit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/deposit')>()),
  fetchAccountBalances,
}))
const messengerAbi = parseAbi([
  'function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)',
])
const fetchForwardFee = vi.hoisted(() => vi.fn())
vi.mock('../lib/iris', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/iris')>()), fetchForwardFee }))
vi.mock('../lib/clients', () => ({ arcClient: {} }))

let send: ReturnType<typeof vi.fn<(...args: Parameters<Sender['send']>) => Promise<TxResult>>>

beforeEach(() => {
  send = vi.fn(async () => ({ status: 'success', hash: HASH, receipt: {} }) as TxResult)
  fetchForwardFee.mockResolvedValue({ maxFee: 150_000n, protocolFee: 0n, forwardFee: 150_000n })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  balances.usdc = 0n
  balances.eurc = 0n
})

function renderForm(kind: Sender['kind'] = 'passkey') {
  const sender: Sender = { kind, address: ACCOUNT, send }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AccountWithdraw sender={sender} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function fill(amount: string, recipient: string) {
  await userEvent.type(screen.getByLabelText('Amount'), amount)
  await userEvent.type(screen.getByLabelText('Recipient'), recipient)
}

const submitButton = () => screen.getByRole('button', { name: 'Send' })

describe('AccountWithdraw', () => {
  // A wallet would send approve and burn as two transactions, so a failed burn could leave an open approval.
  it('renders nothing for a regular wallet', () => {
    renderForm('eoa')
    expect(screen.queryByRole('heading', { name: 'Send money out' })).toBeNull()
  })

  // The account's own address would only burn gas, and spending the gas buffer would strand the account.
  it('refuses own address and gas-buffer overdraw', async () => {
    balances.usdc = 1_000000n
    renderForm()
    await screen.findByText(/You have 1.00 USDC/)
    await fill('0.5', ACCOUNT.toLowerCase())
    expect(screen.getByText('Choose a different address.')).toBeTruthy()
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true)

    await userEvent.clear(screen.getByLabelText('Recipient'))
    await userEvent.type(screen.getByLabelText('Recipient'), FRIEND)
    await userEvent.clear(screen.getByLabelText('Amount'))
    // 1.00 USDC held, 0.05 kept for gas: 0.96 is too much.
    await userEvent.type(screen.getByLabelText('Amount'), '0.96')
    expect(screen.getByText('Leave at least 0.05 USDC in your Fundit account for the network fee.')).toBeTruthy()
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(submitButton())
    expect(send).not.toHaveBeenCalled()

    // Max fills in exactly what can go out.
    await userEvent.click(screen.getByRole('button', { name: 'Max' }))
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('0.95')
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false)
  })

  // The form's balance can be up to 15 seconds old, or spent from another tab. The send must check a fresh one.
  it('refuses at send time when the fresh balance no longer leaves the gas reserve', async () => {
    balances.usdc = 1_000000n
    renderForm()
    await screen.findByText(/You have 1.00 USDC/)
    await fill('0.9', FRIEND)
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false)
    balances.usdc = 900000n
    await userEvent.click(submitButton())
    expect((await screen.findAllByText('Leave at least 0.05 USDC in your Fundit account for the network fee.')).length).toBeGreaterThan(0)
    expect(send).not.toHaveBeenCalled()
  })

  // EURC has no gas reserve of its own, but the network fee is still paid in USDC.
  it('asks for USDC gas before sending EURC', async () => {
    balances.usdc = 10_000n
    balances.eurc = 5_000000n
    renderForm()
    await userEvent.selectOptions(screen.getByLabelText('Currency'), 'EURC')
    await screen.findByText(/You have 5.00 EURC/)
    await fill('5', FRIEND)
    expect(screen.getByText(/Add at least 0.05 USDC to your Fundit account first/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add money' }).getAttribute('href')).toBe('/add-money')
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('lets the full EURC balance go when there is USDC for gas, on Arc only', async () => {
    balances.usdc = 50_000n
    balances.eurc = 5_000000n
    renderForm()
    await userEvent.selectOptions(screen.getByLabelText('Currency'), 'EURC')
    await screen.findByText(/You have 5.00 EURC/)
    expect(screen.getAllByRole('option', { name: /Base|Arc/ }).map((o) => o.textContent)).toEqual(['Arc'])
    expect(screen.getByText('EURC can only be sent on Arc.')).toBeTruthy()
    await fill('5', FRIEND)
    await userEvent.click(submitButton())
    await screen.findByText('Your money was sent.')
    const [calls] = send.mock.calls[0]!
    expect(calls).toHaveLength(1)
    expect(calls[0]!.to).toBe(TOKENS.EURC.address)
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data }).args).toEqual([FRIEND, 5_000000n])
  })

  // One click, one send: a quick second click while the first is in flight sends nothing more.
  it('sends once per click', async () => {
    balances.usdc = 10_000000n
    let finish: (r: TxResult) => void = () => {}
    send.mockImplementation(() => new Promise<TxResult>((r) => (finish = r)))
    renderForm()
    await screen.findByText(/You have 10.00 USDC/)
    await fill('2', FRIEND)
    await userEvent.dblClick(submitButton())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    finish({ status: 'success', hash: HASH, receipt: {} as never })
    await screen.findByText('Your money was sent.')
    expect(send).toHaveBeenCalledTimes(1)
  })

  // A timed-out send may still go through, so the form stays locked until it is checked or the person starts over.
  it('blocks a resubmit after a timeout', async () => {
    balances.usdc = 10_000000n
    send.mockResolvedValue({ status: 'timeout', hash: HASH, completed: 0, hashKind: 'userop' })
    renderForm()
    await screen.findByText(/You have 10.00 USDC/)
    await fill('2', FRIEND)
    await userEvent.click(submitButton())
    await screen.findByText(/is not confirmed yet/)
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    expect(screen.getByLabelText('Amount').matches(':disabled')).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })

  // Fast is the default, as on the organiser's payout form, and the passkey is tapped once for both calls.
  it('sends to Base as approve and burn in one send, with a fresh quote', async () => {
    balances.usdc = 10_000000n
    renderForm()
    await screen.findByText(/You have 10.00 USDC/)
    await userEvent.selectOptions(screen.getByLabelText('Send to'), 'Base')
    expect(screen.getByText('Make sure you control this address on Base.')).toBeTruthy()
    expect((screen.getByRole('radio', { name: /Fast/ }) as HTMLInputElement).checked).toBe(true)
    await fill('2', FRIEND)
    await screen.findByText('At least 1.85 USDC')
    // The quote at send time is lower than the preview, so the burn must carry the fresh fee, not the preview's.
    fetchForwardFee.mockResolvedValueOnce({ maxFee: 120_000n, protocolFee: 0n, forwardFee: 120_000n })
    await userEvent.click(submitButton())
    await screen.findByText(/It arrives on Base in about a minute/)
    expect(fetchForwardFee).toHaveBeenLastCalledWith(26, 6, 2_000000n, true)
    expect(send).toHaveBeenCalledTimes(1)
    const [calls] = send.mock.calls[0]!
    expect(calls.map((c) => c.to)).toEqual([TOKENS.USDC.address, TOKEN_MESSENGER_V2])
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data }).args).toEqual([TOKEN_MESSENGER_V2, 2_000000n])
    expect(decodeFunctionData({ abi: messengerAbi, data: calls[1]!.data }).args).toEqual([
      2_000000n,
      6,
      pad(FRIEND, { size: 32 }),
      TOKENS.USDC.address,
      zeroHash,
      120_000n,
      1000,
      FORWARD_HOOK_DATA,
    ])
  })

  // A mixed-case address carries a checksum. If it does not match, a character was mistyped, and a burn to
  // another chain would mint to that wrong address with no way back.
  it('refuses a recipient with a bad checksum and accepts all lowercase', async () => {
    balances.usdc = 10_000000n
    renderForm()
    await screen.findByText(/You have 10.00 USDC/)
    await userEvent.selectOptions(screen.getByLabelText('Send to'), 'Base')
    await fill('2', '0xaBcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD')
    expect(screen.getByText('This address has a typo. Check it and paste it again.')).toBeTruthy()
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(submitButton())
    expect(send).not.toHaveBeenCalled()

    await userEvent.clear(screen.getByLabelText('Recipient'))
    await userEvent.type(screen.getByLabelText('Recipient'), '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')
    expect(screen.queryByText('This address has a typo. Check it and paste it again.')).toBeNull()
    await screen.findByText('At least 1.85 USDC')
    await userEvent.click(submitButton())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    const [calls] = send.mock.calls[0]!
    expect(decodeFunctionData({ abi: messengerAbi, data: calls[1]!.data }).args[2]).toBe(
      pad('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', { size: 32 }),
    )
  })

  // A stale balance after a send would let the next send be built on money that already left.
  it('reads the balance again after a send', async () => {
    balances.usdc = 10_000000n
    renderForm()
    await screen.findByText(/You have 10.00 USDC/)
    await fill('2', FRIEND)
    const readsBefore = fetchAccountBalances.mock.calls.length
    balances.usdc = 8_000000n
    await userEvent.click(submitButton())
    await screen.findByText('Your money was sent.')
    await screen.findByText(/You have 8.00 USDC/)
    expect(fetchAccountBalances.mock.calls.length).toBeGreaterThan(readsBefore)
  })

  it('stops when the fee went up between the preview and the send', async () => {
    balances.usdc = 10_000000n
    renderForm()
    await screen.findByText(/You have 10.00 USDC/)
    await userEvent.selectOptions(screen.getByLabelText('Send to'), 'Base')
    await fill('2', FRIEND)
    await screen.findByText('At least 1.85 USDC')
    fetchForwardFee.mockResolvedValue({ maxFee: 300_000n, protocolFee: 0n, forwardFee: 300_000n })
    await userEvent.click(submitButton())
    await screen.findByText('The transfer fee changed. Check the new amount and confirm again.')
    expect(send).not.toHaveBeenCalled()
  })
})
