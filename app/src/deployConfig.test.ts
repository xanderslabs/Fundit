import { zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import headers from '../public/_headers?raw'
import { checkBuildEnv, loadConfig } from './deployConfig'

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

// Checks only a production build runs, after loadConfig. Each catches a site that builds but cannot work.
describe('checkBuildEnv', () => {
  const ok = { PROD: true }

  it('passes the defaults and the real _headers', () => {
    expect(() => checkBuildEnv(ok, headers)).not.toThrow()
    expect(() => checkBuildEnv({ ...ok, VITE_ARC_RPC_URL: 'https://rpc.mainnet.arc.io', VITE_MAINNET_RPC_URL: 'https://ethereum-rpc.publicnode.com' }, headers)).not.toThrow()
  })

  // Passkeys on with no client key would show a sign-in that always fails.
  it('fails with VITE_PASSKEYS=1 and no VITE_CIRCLE_CLIENT_KEY', () => {
    expect(() => checkBuildEnv({ ...ok, VITE_PASSKEYS: '1' }, headers)).toThrow(/VITE_CIRCLE_CLIENT_KEY/)
    expect(() => checkBuildEnv({ ...ok, VITE_PASSKEYS: '1', VITE_CIRCLE_CLIENT_KEY: '' }, headers)).toThrow(/VITE_CIRCLE_CLIENT_KEY/)
    expect(() => checkBuildEnv({ ...ok, VITE_PASSKEYS: '1', VITE_CIRCLE_CLIENT_KEY: 'key' }, headers)).not.toThrow()
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
    expect(() => checkBuildEnv({ PROD: false, VITE_PASSKEYS: '1', VITE_ARC_RPC_URL: 'http://127.0.0.1:8545' }, headers)).not.toThrow()
  })
})
