/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REOWN_PROJECT_ID?: string
  readonly VITE_CIRCLE_CLIENT_KEY?: string
  readonly VITE_FACTORY_ADDRESS?: string
  readonly VITE_FACTORY_DEPLOY_BLOCK?: string
  readonly VITE_ARC_RPC_URL?: string
  readonly VITE_MAINNET_RPC_URL?: string
  readonly VITE_CROSSCHAIN?: string
  readonly VITE_ARC_NETWORK?: string
  readonly VITE_ALLOW_TESTNET_BUILD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
