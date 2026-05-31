import { ChronikClient } from "chronik-client";
import { config } from "../config.js";
import { AppError, errorMessage } from "../utils/errors.js";

export type BlockchainAdapter = {
  getTokenBalance(address: string, tokenId: string): Promise<{ tokenId: string; amount: string } | null>;
};

const CASHADDR_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  const maxv = (1 << toBits) - 1;

  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) {
      throw new Error("Invalid CashAddr payload");
    }
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }

  if (pad && bits > 0) {
    result.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw new Error("Invalid CashAddr padding");
  }

  return result;
}

function toHex(bytes: number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cashaddrToChronikScript(address: string): { scriptType: "p2pkh" | "p2sh"; scriptPayload: string } {
  const normalized = address.trim().toLowerCase();
  const [, payloadWithChecksum] = normalized.split(":");
  if (!payloadWithChecksum) {
    throw new Error("Address must include ecash: prefix");
  }

  const payload = payloadWithChecksum.slice(0, -8);
  const values = [...payload].map((char) => {
    const value = CASHADDR_CHARSET.indexOf(char);
    if (value === -1) throw new Error("Invalid CashAddr character");
    return value;
  });

  const bytes = convertBits(values, 5, 8, false);
  const version = bytes[0];
  const hash = bytes.slice(1);
  const scriptKind = version >> 3;

  if (scriptKind === 0) {
    return { scriptType: "p2pkh", scriptPayload: toHex(hash) };
  }
  if (scriptKind === 1) {
    return { scriptType: "p2sh", scriptPayload: toHex(hash) };
  }

  throw new Error("Unsupported CashAddr script type");
}

export function createChronikAdapter(): BlockchainAdapter {
  const chronik = new ChronikClient(config.chronikUrl);

  return {
    async getTokenBalance(address: string, tokenId: string): Promise<{ tokenId: string; amount: string } | null> {
      if (tokenId !== config.rmzTokenId) {
        return null;
      }

      try {
        // Chronik-client v0.x queries by script. If a future Tonalli Chronik client
        // exposes address(address).utxos(), this adapter can be simplified.
        const script = cashaddrToChronikScript(address);
        const groups = await chronik.script(script.scriptType, script.scriptPayload).utxos();

        let balance = 0n;
        for (const group of groups) {
          for (const utxo of group.utxos) {
            if (utxo.slpMeta?.tokenId === tokenId && utxo.slpToken?.amount) {
              balance += BigInt(utxo.slpToken.amount);
            }
          }
        }

        return balance > 0n ? { tokenId, amount: balance.toString() } : null;
      } catch (error) {
        throw new AppError(503, `Chronik no respondio correctamente: ${errorMessage(error)}`);
      }
    }
  };
}
