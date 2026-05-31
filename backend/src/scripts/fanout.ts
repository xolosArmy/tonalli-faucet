import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { config } from "../config.js";
import { errorMessage } from "../utils/errors.js";
import { callBitcoinAbcRpc } from "./bitcoinAbcWalletRpc.js";

type FanoutOptions = {
  count: number;
  amount: number;
  label: string;
  dryRun: boolean;
  createAddresses: boolean;
  allowWhileEnabled: boolean;
};

function usage(): string {
  return [
    "Uso: tsx src/scripts/fanout.ts --count 100 --amount 1000 --label tonalli-faucet-fanout [--dry-run] [--create-addresses] [--allow-while-enabled]",
    "",
    "Opciones:",
    "  --count <n>                 Numero de UTXOs a crear. Rango: 1-500.",
    "  --amount <xec>              Monto por UTXO en XEC. Debe ser mayor que CLAIM_AMOUNT_XEC.",
    "  --label <label>             Label para getnewaddress(label).",
    "  --dry-run                   Muestra el plan sin enviar fondos.",
    "  --create-addresses          En dry-run, crea direcciones reales para inspeccionar el plan.",
    "  --allow-while-enabled       Permite fan-out aunque FAUCET_ENABLED=true."
  ].join("\n");
}

function readOptions(argv: string[]): FanoutOptions {
  const options: Partial<FanoutOptions> = {
    dryRun: false,
    createAddresses: false,
    allowWhileEnabled: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--create-addresses") {
      options.createAddresses = true;
    } else if (arg === "--allow-while-enabled") {
      options.allowWhileEnabled = true;
    } else if (arg === "--count") {
      options.count = Number(argv[++index]);
    } else if (arg === "--amount") {
      options.amount = Number(argv[++index]);
    } else if (arg === "--label") {
      options.label = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Parametro no reconocido: ${arg}`);
    }
  }

  return {
    count: options.count ?? 100,
    amount: options.amount ?? 1000,
    label: options.label ?? "tonalli-faucet-fanout",
    dryRun: options.dryRun ?? false,
    createAddresses: options.createAddresses ?? false,
    allowWhileEnabled: options.allowWhileEnabled ?? false
  };
}

function validateOptions(options: FanoutOptions): void {
  const claimAmount = Number(config.claimAmountXec);
  if (!Number.isInteger(options.count) || options.count < 1 || options.count > 500) {
    throw new Error("--count debe ser un entero entre 1 y 500.");
  }
  if (!Number.isFinite(options.amount) || options.amount <= 0) {
    throw new Error("--amount debe ser un numero positivo.");
  }
  if (!Number.isFinite(claimAmount) || claimAmount <= 0) {
    throw new Error("CLAIM_AMOUNT_XEC debe ser un numero positivo.");
  }
  if (options.amount <= claimAmount) {
    throw new Error(`--amount debe ser mayor que CLAIM_AMOUNT_XEC (${claimAmount} XEC).`);
  }
  if (options.label.trim() === "") {
    throw new Error("--label no puede estar vacio.");
  }
  if (config.faucetEnabled && !options.allowWhileEnabled) {
    throw new Error("FAUCET_ENABLED=true. Desactiva la faucet o usa --allow-while-enabled explicitamente.");
  }
}

async function confirmFanout(): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question('Escribe exactamente "CONFIRM FANOUT" para enviar la transaccion: ');
    if (answer !== "CONFIRM FANOUT") {
      throw new Error("Confirmacion invalida. Fan-out cancelado sin enviar fondos.");
    }
  } finally {
    rl.close();
  }
}

async function createFanoutAddresses(count: number, label: string): Promise<string[]> {
  const addresses: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const address = await callBitcoinAbcRpc<string>("getnewaddress", [label]);
    if (typeof address !== "string" || !address.startsWith("ecash:")) {
      throw new Error(`getnewaddress devolvio una direccion invalida en posicion ${index + 1}.`);
    }
    addresses.push(address);
  }
  return addresses;
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  validateOptions(options);

  const total = options.count * options.amount;
  const balance = await callBitcoinAbcRpc<number>("getbalance");
  if (!Number.isFinite(balance)) {
    throw new Error("getbalance no devolvio un numero valido.");
  }
  if (balance <= total) {
    throw new Error(`Balance insuficiente. Disponible: ${balance} XEC. Requerido: mas de ${total} XEC para cubrir tambien el fee.`);
  }

  console.log("Plan de fan-out Tonalli Faucet");
  console.log(`- UTXOs nuevos: ${options.count}`);
  console.log(`- Monto por UTXO: ${options.amount} XEC`);
  console.log(`- Total a distribuir: ${total} XEC mas fee de red`);
  console.log(`- Label: ${options.label}`);
  console.log(`- Balance actual: ${balance} XEC`);
  console.log(`- Dry-run: ${options.dryRun ? "si" : "no"}`);

  if (options.dryRun && !options.createAddresses) {
    console.log("Dry-run completado. No se crearon direcciones ni se enviaron fondos.");
    return;
  }

  if (!options.dryRun) {
    await confirmFanout();
  }

  const addresses = await createFanoutAddresses(options.count, options.label);
  const outputs = Object.fromEntries(addresses.map((address) => [address, options.amount]));

  if (options.dryRun) {
    console.log(`Direcciones creadas: ${addresses.length}`);
    console.log("Dry-run completado. No se llamo sendmany.");
    return;
  }

  const txid = await callBitcoinAbcRpc<string>("sendmany", ["", outputs]);
  if (typeof txid !== "string" || txid.length === 0) {
    throw new Error("sendmany no devolvio txid.");
  }

  console.log(`Fan-out enviado. txid: ${txid}`);
  console.log("Espera al menos 1 confirmacion antes de activar la faucet para el evento.");
  console.log("Verifica el resultado con: npm run wallet:status --workspace backend");
}

main().catch((error) => {
  console.error(`Error de fan-out: ${errorMessage(error)}`);
  process.exitCode = 1;
});
