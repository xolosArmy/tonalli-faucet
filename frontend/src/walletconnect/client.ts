import SignClient from "@walletconnect/sign-client";

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

let clientPromise: Promise<SignClient> | null = null;
let activeSession: { topic: string } | null = null;

function getClient(): Promise<SignClient> {
  if (!projectId) {
    throw new Error("Falta VITE_WALLETCONNECT_PROJECT_ID");
  }

  clientPromise ??= SignClient.init({
    projectId,
    metadata: {
      name: "Faucet Tonalli",
      description: "Faucet de XEC para Tonalli Wallet",
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.ico`]
    }
  });

  return clientPromise;
}

function firstEcashAddress(value: unknown): string | null {
  if (typeof value === "string" && value.startsWith("ecash:")) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstEcashAddress(item);
      if (found) return found;
    }
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = firstEcashAddress(item);
      if (found) return found;
    }
  }
  return null;
}

function ecashAddressFromAccount(account: string): string | null {
  const address = account.split(":").slice(2).join(":");
  return address.startsWith("ecash:") ? address : null;
}

export async function connectTonalliWallet(onUri: (uri: string) => void): Promise<string> {
  const client = await getClient();

  // Ajustar chains/methods si Tonalli Wallet publica otro namespace CAIP-2 para eCash.
  // El metodo ecash_getAddresses debe devolver una direccion o una lista/objeto con direcciones ecash:.
  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      ecash: {
        chains: ["ecash:mainnet"],
        methods: ["ecash_getAddresses"],
        events: ["accountsChanged", "disconnect"]
      }
    }
  });

  if (uri) {
    onUri(uri);
  }

  const session = await approval();
  activeSession = session;

  const accountAddress = session.namespaces.ecash?.accounts?.map(ecashAddressFromAccount).find(Boolean);
  if (accountAddress) return accountAddress;

  const topic = session.topic;
  const chainId = session.namespaces.ecash?.chains?.[0] ?? "ecash:mainnet";
  const result = await client.request({
    topic,
    chainId,
    request: {
      method: "ecash_getAddresses",
      params: {}
    }
  });

  const address = firstEcashAddress(result);
  if (!address) {
    throw new Error("Tonalli Wallet no devolvio una direccion eCash.");
  }
  return address;
}

export async function disconnectTonalliWallet(): Promise<void> {
  if (!activeSession) return;

  const client = await getClient();
  const session = activeSession;
  activeSession = null;
  await client.disconnect({
    topic: session.topic,
    reason: {
      code: 6000,
      message: "Claim completado"
    }
  });
}
