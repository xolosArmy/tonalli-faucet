import { config } from "../config.js";
import { AppError, errorMessage } from "../utils/errors.js";
export async function sendXecToAddress(address, amountXec) {
    const amount = Number(amountXec);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new AppError(500, "Monto de faucet invalido");
    }
    const auth = Buffer.from(`${config.bitcoinAbcRpcUser}:${config.bitcoinAbcRpcPass}`).toString("base64");
    let response;
    try {
        response = await fetch(config.bitcoinAbcRpcUrl, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Basic ${auth}`
            },
            body: JSON.stringify({
                jsonrpc: "1.0",
                id: "tonalli-faucet-send",
                method: "sendtoaddress",
                params: [address, amount]
            })
        });
    }
    catch (error) {
        throw new AppError(502, `No se pudo conectar con Bitcoin ABC RPC: ${errorMessage(error)}`);
    }
    if (!response.ok) {
        throw new AppError(502, `Bitcoin ABC RPC respondio HTTP ${response.status}`);
    }
    const payload = (await response.json());
    if (payload.error) {
        throw new AppError(502, `Bitcoin ABC RPC error ${payload.error.code}: ${payload.error.message}`);
    }
    if (typeof payload.result !== "string" || payload.result.length === 0) {
        throw new AppError(502, "Bitcoin ABC RPC no devolvio txid");
    }
    return payload.result;
}
