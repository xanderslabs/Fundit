import { zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import headers from '../public/_headers?raw'
import mainnetDeployment from '../../contracts/deployments/arc-mainnet.json'
import { checkBuildEnv, KNOWN_FACTORIES, loadConfig, parseArcNetwork } from './deployConfig'

const FACTORY = '0x1111111111111111111111111111111111111111'
const prodEnv = { PROD: true, VITE_FACTORY_ADDRESS: FACTORY, VITE_FACTORY_DEPLOY_BLOCK: '26280000', VITE_REOWN_PROJECT_ID: 'abc123' }

// A production bundle pointing at 0x0, or without a Reown project id, deploys a site
// where nothing loads and no wallet connects. The build must fail instead.
describe('loadConfig', () => {
  it('reads a complete production env', () => {
    expect(loadConfig(prodEnv)).toEqual({ factoryAddress: FACTORY, factoryDeployBlock: 26280000n, reownProjectId: 'abc123' })
  })

  it('throws when the factory address is set but the deploy block is missing, in any mode', () => {
    expect(() => loadConfig({ PROD: false, VITE_FACTORY_ADDRESS: FACTORY })).toThrow(/VITE_FACTORY_DEPLOY_BLOCK/)
    expect(() => loadConfig({ ...prodEnv, VITE_FACTORY_DEPLOY_BLOCK: '' })).toThrow(/VITE_FACTORY_DEPLOY_BLOCK/)
  })

  it('throws in production when the factory address is missing', () => {
    expect(() => loadConfig({ ...prodEnv, VITE_FACTORY_ADDRESS: undefined })).toThrow(/VITE_FACTORY_ADDRESS/)
  })

  it('throws in production when the factory deploy block is missing', () => {
    expect(() => loadConfig({ ...prodEnv, VITE_FACTORY_ADDRESS: undefined, VITE_FACTORY_DEPLOY_BLOCK: undefined })).toThrow(/VITE_FACTORY/)
  })

  it('throws in production when the Reown project id is empty', () => {
    expect(() => loadConfig({ ...prodEnv, VITE_REOWN_PROJECT_ID: '' })).toThrow(/VITE_REOWN_PROJECT_ID/)
  })

  it('uses zero defaults in dev and test only when both factory vars are unset', () => {
    expect(loadConfig({ PROD: false })).toEqual({ factoryAddress: zeroAddress, factoryDeployBlock: 0n, reownProjectId: '' })
  })

  it('throws on a deploy block without an address, and on malformed values', () => {
    expect(() => loadConfig({ PROD: false, VITE_FACTORY_DEPLOY_BLOCK: '1' })).toThrow(/VITE_FACTORY_ADDRESS/)
    expect(() => loadConfig({ PROD: false, VITE_FACTORY_ADDRESS: '0x123', VITE_FACTORY_DEPLOY_BLOCK: '1' })).toThrow(/not a valid address/)
    expect(() => loadConfig({ PROD: false, VITE_FACTORY_ADDRESS: FACTORY, VITE_FACTORY_DEPLOY_BLOCK: '1e6' })).toThrow(/block number/)
  })
})

// A factory from the other network has no code here: the site lists no Fundits and Create spends gas on a call
// that does nothing. A wrong deploy block for the right factory makes the campaign scan miss or skip Fundits.
describe('loadConfig factory and network', () => {
  const MAINNET = KNOWN_FACTORIES.mainnet.address
  const TESTNET = KNOWN_FACTORIES.testnet.address
  const mainnet = { ...prodEnv, VITE_FACTORY_ADDRESS: MAINNET, VITE_FACTORY_DEPLOY_BLOCK: '26452579' }
  const testnet = { ...prodEnv, VITE_ARC_NETWORK: 'testnet', VITE_FACTORY_ADDRESS: TESTNET, VITE_FACTORY_DEPLOY_BLOCK: '67870064' }

  it('matches the mainnet deployment record', () => {
    expect(MAINNET).toBe(mainnetDeployment.contracts.CampaignFactory)
    expect(KNOWN_FACTORIES.mainnet.deployBlock).toBe(BigInt(mainnetDeployment.deployBlock))
  })

  it('accepts each known factory with its own network and deploy block', () => {
    expect(loadConfig(mainnet).factoryAddress).toBe(MAINNET)
    expect(loadConfig({ ...mainnet, VITE_ARC_NETWORK: 'mainnet' }).factoryDeployBlock).toBe(26452579n)
    expect(loadConfig(testnet).factoryAddress).toBe(TESTNET)
  })

  it("refuses the other network's factory, in any case and in any mode", () => {
    expect(() => loadConfig({ ...mainnet, VITE_FACTORY_ADDRESS: TESTNET, VITE_FACTORY_DEPLOY_BLOCK: '67870064' })).toThrow(/Arc testnet factory/)
    expect(() => loadConfig({ ...mainnet, VITE_FACTORY_ADDRESS: TESTNET.toLowerCase() })).toThrow(/Arc testnet factory/)
    expect(() => loadConfig({ ...testnet, VITE_FACTORY_ADDRESS: MAINNET, VITE_FACTORY_DEPLOY_BLOCK: '26452579' })).toThrow(/Arc mainnet factory/)
    expect(() => loadConfig({ ...testnet, PROD: false, VITE_FACTORY_ADDRESS: MAINNET })).toThrow(/Arc mainnet factory/)
  })

  it('refuses a deploy block that is not the known one for a known factory', () => {
    expect(() => loadConfig({ ...mainnet, VITE_FACTORY_DEPLOY_BLOCK: '26452578' })).toThrow(/deployed at block 26452579/)
    expect(() => loadConfig({ ...mainnet, VITE_FACTORY_DEPLOY_BLOCK: '0' })).toThrow(/VITE_FACTORY_DEPLOY_BLOCK/)
    // The testnet block with the mainnet factory: a copy slip that would hide every Fundit.
    expect(() => loadConfig({ ...mainnet, VITE_FACTORY_DEPLOY_BLOCK: '67870064' })).toThrow(/VITE_FACTORY_DEPLOY_BLOCK/)
    expect(() => loadConfig({ ...testnet, VITE_FACTORY_DEPLOY_BLOCK: '26452579' })).toThrow(/deployed at block 67870064/)
  })

  it('leaves an unknown factory alone, such as a local deploy', () => {
    expect(() => loadConfig({ ...testnet, VITE_FACTORY_ADDRESS: FACTORY, VITE_FACTORY_DEPLOY_BLOCK: '1' })).not.toThrow()
  })
})

// Checks only a production build runs, after loadConfig. Each catches a site that builds but cannot work.
describe('checkBuildEnv', () => {
  const ok = { PROD: true, VITE_CIRCLE_CLIENT_KEY: 'key' }

  it('passes the defaults and the real _headers', () => {
    expect(() => checkBuildEnv(ok, headers)).not.toThrow()
    expect(() => checkBuildEnv({ ...ok, VITE_ARC_RPC_URL: 'https://rpc.mainnet.arc.io', VITE_MAINNET_RPC_URL: 'https://ethereum-rpc.publicnode.com' }, headers)).not.toThrow()
  })

  // Sign-in is passkey only. With no client key every sign-in fails, so nobody could use the site.
  it('fails a production build without VITE_CIRCLE_CLIENT_KEY', () => {
    expect(() => checkBuildEnv({ PROD: true }, headers)).toThrow(/VITE_CIRCLE_CLIENT_KEY/)
    expect(() => checkBuildEnv({ ...ok, VITE_CIRCLE_CLIENT_KEY: '' }, headers)).toThrow(/VITE_CIRCLE_CLIENT_KEY/)
    expect(() => checkBuildEnv({ ...ok, VITE_CIRCLE_CLIENT_KEY: 'key' }, headers)).not.toThrow()
  })

  // The browser blocks an RPC host missing from connect-src, so every read fails at runtime with no build error.
  it('fails when the Arc or mainnet RPC host is not in connect-src', () => {
    expect(() => checkBuildEnv({ ...ok, VITE_ARC_RPC_URL: 'https://arc.example.com' }, headers)).toThrow(/VITE_ARC_RPC_URL/)
    expect(() => checkBuildEnv({ ...ok, VITE_MAINNET_RPC_URL: 'https://eth.example.com' }, headers)).toThrow(/VITE_MAINNET_RPC_URL/)
    // A wildcard entry covers its subdomains, but the scheme must match.
    expect(() => checkBuildEnv({ ...ok, VITE_ARC_RPC_URL: 'https://rpc.drpc.mainnet.arc.io' }, headers)).not.toThrow()
    expect(() => checkBuildEnv({ ...ok, VITE_ARC_RPC_URL: 'http://rpc.mainnet.arc.io' }, headers)).toThrow(/VITE_ARC_RPC_URL/)
    expect(() => checkBuildEnv({ ...ok, VITE_ARC_RPC_URL: 'not a url' }, headers)).toThrow(/VITE_ARC_RPC_URL/)
  })

  it('checks nothing outside production', () => {
    expect(() => checkBuildEnv({ PROD: false, VITE_ARC_RPC_URL: 'http://127.0.0.1:8545' }, headers)).not.toThrow()
  })
})

describe('parseArcNetwork', () => {
  it('defaults to mainnet when VITE_ARC_NETWORK is unset or empty', () => {
    expect(parseArcNetwork(undefined)).toBe('mainnet')
    expect(parseArcNetwork('')).toBe('mainnet')
  })

  it('accepts mainnet and testnet', () => {
    expect(parseArcNetwork('mainnet')).toBe('mainnet')
    expect(parseArcNetwork('testnet')).toBe('testnet')
  })

  // A typo must not quietly build a mainnet (or testnet) site.
  it('throws on any other value', () => {
    expect(() => parseArcNetwork('Testnet')).toThrow(/VITE_ARC_NETWORK/)
    expect(() => parseArcNetwork('sepolia')).toThrow(/VITE_ARC_NETWORK/)
  })
})

// A testnet bundle shows worthless test tokens as gifts. Shipping one by accident, with a stray VITE_ARC_NETWORK,
// would mislead every visitor, so a production testnet build needs an explicit opt-in.
describe('checkBuildEnv network guard', () => {
  it('refuses a production build with VITE_ARC_NETWORK=testnet', () => {
    expect(() => checkBuildEnv({ PROD: true, VITE_ARC_NETWORK: 'testnet' }, headers)).toThrow(/VITE_ALLOW_TESTNET_BUILD/)
  })

  it('allows a production testnet build only with VITE_ALLOW_TESTNET_BUILD=1', () => {
    expect(() => checkBuildEnv({ PROD: true, VITE_CIRCLE_CLIENT_KEY: 'key', VITE_ARC_NETWORK: 'testnet', VITE_ALLOW_TESTNET_BUILD: '1' }, headers)).not.toThrow()
    expect(() => checkBuildEnv({ PROD: true, VITE_ARC_NETWORK: 'testnet', VITE_ALLOW_TESTNET_BUILD: 'true' }, headers)).toThrow(/VITE_ALLOW_TESTNET_BUILD/)
  })

  it('allows a production mainnet build, and testnet outside production', () => {
    expect(() => checkBuildEnv({ PROD: true, VITE_CIRCLE_CLIENT_KEY: 'key' }, headers)).not.toThrow()
    expect(() => checkBuildEnv({ PROD: true, VITE_CIRCLE_CLIENT_KEY: 'key', VITE_ARC_NETWORK: 'mainnet' }, headers)).not.toThrow()
    expect(() => checkBuildEnv({ PROD: false, VITE_ARC_NETWORK: 'testnet' }, headers)).not.toThrow()
  })

  it('fails any build on an unknown network name', () => {
    expect(() => checkBuildEnv({ PROD: false, VITE_ARC_NETWORK: 'devnet' }, headers)).toThrow(/VITE_ARC_NETWORK/)
  })
})

// A leftover VITE_ARC_RPC_URL from the other network would read the wrong chain's state with no error.
describe('checkBuildEnv Arc RPC network', () => {
  it('refuses a mainnet Arc RPC on a testnet build, and a testnet RPC on a mainnet build', () => {
    expect(() => checkBuildEnv({ PROD: false, VITE_ARC_NETWORK: 'testnet', VITE_ARC_RPC_URL: 'https://rpc.mainnet.arc.io' }, headers)).toThrow(/VITE_ARC_RPC_URL/)
    expect(() => checkBuildEnv({ PROD: false, VITE_ARC_RPC_URL: 'https://rpc.testnet.arc.io' }, headers)).toThrow(/VITE_ARC_RPC_URL/)
  })

  it("accepts the network's own RPC and a local fork", () => {
    expect(() => checkBuildEnv({ PROD: false, VITE_ARC_NETWORK: 'testnet', VITE_ARC_RPC_URL: 'https://rpc.testnet.arc.io' }, headers)).not.toThrow()
    expect(() => checkBuildEnv({ PROD: false, VITE_ARC_RPC_URL: 'http://127.0.0.1:8545' }, headers)).not.toThrow()
  })
})
