import { createAppKit } from "@reown/appkit/react";
import PropTypes from "prop-types";
import {
  defineChain,
  arbitrum,
  mainnet,
  polygon,
  optimism,
  bsc,
  sonic,
  soneium,
  base,
  avalanche,
  mantle,
  linea,
  unichain,
} from "@reown/appkit/networks";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";

const metis = defineChain({
  id: 1088,
  caipNetworkId: "eip155:123456789",
  chainNamespace: "eip155",
  name: "Metis",
  nativeCurrency: {
    decimals: 18,
    name: "Metis",
    symbol: "METIS",
  },
  rpcUrls: {
    default: {
      http: [
        "https://lb.drpc.org/ogrpc?network=metis&dkey=REDACTED_DRPC_KEY",
      ],
      webSocket: [
        "wss://lb.drpc.org/ogws?network=metis&dkey=REDACTED_DRPC_KEY",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Metis Explorer",
      url: "https://explorer.metis.io",
      apiUrl:
        "https://api.routescan.io/v2/network/mainnet/evm/1088/etherscan/api",
    },
  },
  contracts: {
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11",
      blockCreated: 2_338_552,
    },
  },
});

// 0. Setup queryClient
const queryClient = new QueryClient();

// 1. Get projectId from https://cloud.reown.com
const projectId = import.meta.env.VITE_PROJECT_ID;

// 2. Create a metadata object - optional
const metadata = {
  name: "Fundit.Fun",
  description: "Crowdfunding the $FUN way",
  url: "https://fundit.fun",
  icons: ["/assets/images/icon.svg"],
};

// 3. Set the networks
const networks = [
  polygon,
  arbitrum,
  mainnet,
  optimism,
  bsc,
  sonic,
  soneium,
  base,
  avalanche,
  mantle,
  linea,
  unichain,
  metis,
];

// 4. Create Wagmi Adapter
const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true,
});

for (const chain of wagmiAdapter.wagmiConfig.chains) {
  if (chain.id === 1088) {
    chain.rpcUrls.default.http = [
      "https://lb.drpc.org/ogrpc?network=metis&dkey=REDACTED_DRPC_KEY",
    ];
  }
}

// 5. Create modal
createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata,
  themeVariables: {
    "--w3m-font-family": "var(--font-family-outfit)",
    "--w3m-accent": "var(--fun-green)",
    "--w3m-border-radius-master": "6px",
    "--w3m-qr-color": "var(--fun-green)",
  },
  themeMode: "light",
  features: {
    email: true,
    socials: [
      "google",
      "x",
      "github",
      "discord",
      "apple",
      "facebook",
      "farcaster",
    ],
    emailShowWallets: true,
    analytics: true,
    swaps: false,
    onramp: false,
    connectMethodsOrder: ["social", "email", "wallet"],
    legalCheckbox: true,
  },
  allWallets: "SHOW",
  enableCoinbase: true,
  coinbasePreference: "all",
});

AppKitProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export function AppKitProvider({ children }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
