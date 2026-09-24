import express from "express";
import cors from "cors";
import type { CorsOptions } from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config, isProduction } from "./config.js";
import "./db.js";
import { faucetRouter } from "./routes/faucet.js";
import { statusRouter } from "./routes/status.js";
import { socialRouter } from "./routes/social.js";
import { AppError, serverErrorMessage } from "./utils/errors.js";

const app = express();
const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("CORS origin not allowed"));
  }
};

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: "32kb" }));

app.use(rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    (req.method === "GET" && /^\/(?:api\/)?v1\/social\/telegram\/session\//.test(req.path)) ||
    (req.method === "POST" && /^\/(?:api\/)?v1\/social\/telegram\/webhook$/.test(req.path))
}));

app.use("/api/v1/status", statusRouter);
app.use("/api/v1/faucet", faucetRouter);
app.use("/api/v1/social", socialRouter);
app.use("/v1/status", statusRouter);
app.use("/v1/faucet", faucetRouter);
app.use("/v1/social", socialRouter);

app.use((_req, _res, next) => {
  next(new AppError(404, "Ruta no encontrada"));
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const publicMessage = error instanceof AppError && error.expose ? error.message : "Error interno";

  console.error(serverErrorMessage(error));

  res.status(statusCode).json({
    error: publicMessage,
    ...(isProduction ? {} : { detail: publicMessage })
  });
});

app.listen(config.port, () => {
  console.log(`Tonalli Faucet API listening on port ${config.port}`);
});
