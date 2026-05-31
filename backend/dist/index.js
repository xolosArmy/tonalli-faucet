import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config, isProduction } from "./config.js";
import "./db.js";
import { faucetRouter } from "./routes/faucet.js";
import { statusRouter } from "./routes/status.js";
import { AppError, errorMessage } from "./utils/errors.js";
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: "32kb" }));
app.use(rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
}));
app.use("/api/v1/status", statusRouter);
app.use("/api/v1/faucet", faucetRouter);
app.use((_req, _res, next) => {
    next(new AppError(404, "Ruta no encontrada"));
});
app.use((error, _req, res, _next) => {
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    const publicMessage = error instanceof AppError && error.expose ? error.message : "Error interno";
    if (!isProduction) {
        console.error(errorMessage(error));
    }
    res.status(statusCode).json({
        error: publicMessage,
        ...(isProduction ? {} : { detail: errorMessage(error) })
    });
});
app.listen(config.port, () => {
    console.log(`Tonalli Faucet API listening on port ${config.port}`);
});
