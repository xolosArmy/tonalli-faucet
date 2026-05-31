import { RMZ_TOKEN_ID, hasRMZAccess } from "@xolosarmy/tonalli-core";
import { AppError } from "../utils/errors.js";
import { createChronikAdapter } from "./chronikAdapter.js";
export async function verifyRmzGate(address) {
    const adapter = createChronikAdapter();
    try {
        // Probe Chronik directly first because hasRMZAccess intentionally converts
        // adapter errors into false. Faucet policy needs network failures to be 503.
        await adapter.getTokenBalance(address, RMZ_TOKEN_ID);
        const result = await hasRMZAccess(address, adapter);
        return Boolean(result);
    }
    catch (error) {
        if (error instanceof AppError) {
            throw error;
        }
        throw new AppError(503, "No se pudo verificar acceso RMZ con Chronik");
    }
}
