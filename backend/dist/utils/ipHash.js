import crypto from "node:crypto";
import { config } from "../config.js";
export function hashIp(ip) {
    return crypto.createHmac("sha256", config.ipHashSecret).update(ip).digest("hex");
}
