import { config } from "../config.js";
import { errorMessage } from "../utils/errors.js";
import { callBitcoinAbcRpc, type UnspentOutput } from "./bitcoinAbcWalletRpc.js";

type Bucket = "lt500" | "500to999" | "1000to4999" | "gte5000";

function hasVerboseFlag(argv: string[]): boolean {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Uso: tsx src/scripts/faucetWalletStatus.ts [--verbose]");
    process.exit(0);
  }
  return argv.includes("--verbose");
}

function bucketFor(amount: number): Bucket {
  if (amount < 500) return "lt500";
  if (amount < 1000) return "500to999";
  if (amount < 5000) return "1000to4999";
  return "gte5000";
}

function truncateAddress(address: string | undefined): string {
  if (!address) return "(sin direccion)";
  if (address.length <= 24) return address;
  return `${address.slice(0, 14)}...${address.slice(-8)}`;
}

function printVerbose(title: string, utxos: UnspentOutput[]): void {
  console.log("");
  console.log(title);
  if (utxos.length === 0) {
    console.log("- sin UTXOs");
    return;
  }
  for (const utxo of utxos) {
    console.log(
      `- ${utxo.txid}:${utxo.vout} | ${utxo.amount} XEC | conf=${utxo.confirmations} | ${truncateAddress(utxo.address)}`
    );
  }
}

async function main(): Promise<void> {
  const verbose = hasVerboseFlag(process.argv.slice(2));
  const claimAmount = Number(config.claimAmountXec);
  if (!Number.isFinite(claimAmount) || claimAmount <= 0) {
    throw new Error("CLAIM_AMOUNT_XEC debe ser un numero positivo.");
  }

  const [balance, confirmed, unconfirmed] = await Promise.all([
    callBitcoinAbcRpc<number>("getbalance"),
    callBitcoinAbcRpc<UnspentOutput[]>("listunspent", [1, 9999999]),
    callBitcoinAbcRpc<UnspentOutput[]>("listunspent", [0, 0])
  ]);

  if (!Number.isFinite(balance)) {
    throw new Error("getbalance no devolvio un numero valido.");
  }

  const buckets: Record<Bucket, number> = {
    lt500: 0,
    "500to999": 0,
    "1000to4999": 0,
    gte5000: 0
  };
  for (const utxo of confirmed) {
    buckets[bucketFor(utxo.amount)] += 1;
  }

  const claimReady = confirmed.filter((utxo) => utxo.spendable !== false && utxo.amount >= claimAmount).length;

  console.log("Estado wallet Tonalli Faucet");
  console.log(`- Balance total: ${balance} XEC`);
  console.log(`- UTXOs confirmados: ${confirmed.length}`);
  console.log(`- UTXOs no confirmados: ${unconfirmed.length}`);
  console.log(`- CLAIM_AMOUNT_XEC: ${claimAmount} XEC`);
  console.log(`- UTXOs aptos para claims: ${claimReady}`);
  console.log("");
  console.log("Distribucion aproximada de UTXOs confirmados por monto");
  console.log(`- Menores a 500 XEC: ${buckets.lt500}`);
  console.log(`- 500 a 999 XEC: ${buckets["500to999"]}`);
  console.log(`- 1000 a 4999 XEC: ${buckets["1000to4999"]}`);
  console.log(`- 5000+ XEC: ${buckets.gte5000}`);

  if (verbose) {
    printVerbose("UTXOs confirmados", confirmed);
    printVerbose("UTXOs no confirmados", unconfirmed);
  }
}

main().catch((error) => {
  console.error(`Error consultando wallet: ${errorMessage(error)}`);
  process.exitCode = 1;
});
