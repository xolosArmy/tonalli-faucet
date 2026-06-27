import QRCodeModal from "@walletconnect/qrcode-modal";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  claimFaucet,
  createTelegramSession,
  getFaucetStatus,
  getTelegramSession,
  type FaucetStatus
} from "./api/faucet.js";
import { connectTonalliWallet, disconnectTonalliWallet } from "./walletconnect/client.js";

type ClaimState =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "success"; txid: string; claimCount: number }
  | { kind: "error"; message: string };

type ConnectionState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "waiting" }
  | { kind: "openWallet" }
  | { kind: "connected" }
  | { kind: "error"; message: string };

type TelegramVerificationState = "idle" | "starting" | "waiting" | "verified" | "expired" | "error";

function isMobileUserAgent(userAgent: string): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
}

function connectionLabel(state: ConnectionState): string | null {
  switch (state.kind) {
    case "connecting": return "Conectando";
    case "waiting": return "Esperando conexion";
    case "openWallet": return "Abre Tonalli Wallet";
    case "connected": return "Direccion conectada";
    case "error": return "Error";
    default: return null;
  }
}

export default function App() {
  const [address, setAddress] = useState("");
  const [eventCode, setEventCode] = useState("TONALLI-CU");
  const [twitterHandle, setTwitterHandle] = useState("");
  const [telegramNonce, setTelegramNonce] = useState("");
  const [telegramBotUrl, setTelegramBotUrl] = useState("");
  const [telegramVerificationState, setTelegramVerificationState] = useState<TelegramVerificationState>("idle");
  const [telegramHandle, setTelegramHandle] = useState("");
  const [telegramError, setTelegramError] = useState("");
  const [status, setStatus] = useState<FaucetStatus | null>(null);
  const [claimState, setClaimState] = useState<ClaimState>({ kind: "idle" });
  const [connectionState, setConnectionState] = useState<ConnectionState>({ kind: "idle" });
  const [walletUri, setWalletUri] = useState<string | null>(null);
  const [manualWalletUri, setManualWalletUri] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const [isMobile] = useState(() => isMobileUserAgent(window.navigator.userAgent));
  const qrCloseShouldResetRef = useRef(false);
  const qrClosedWithoutConnectionRef = useRef(false);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const walletDeepLink = walletUri ? `tonalli://wc?uri=${encodeURIComponent(walletUri)}` : null;
  const connectionStatus = connectionLabel(connectionState);
  const isBusy =
    claimState.kind === "loading" ||
    connectionState.kind === "connecting" ||
    connectionState.kind === "waiting" ||
    connectionState.kind === "openWallet";

  function stopTelegramPolling() {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }

  function resetTelegramVerification() {
    stopTelegramPolling();
    setTelegramNonce("");
    setTelegramBotUrl("");
    setTelegramVerificationState("idle");
    setTelegramHandle("");
    setTelegramError("");
  }

  useEffect(() => {
    getFaucetStatus()
      .then(setStatus)
      .catch((error) => setClaimState({ kind: "error", message: error.message }));
    return stopTelegramPolling;
  }, []);

  async function onConnect() {
    setWalletUri(null);
    setManualWalletUri(null);
    setCopyState("idle");
    setAddress("");
    resetTelegramVerification();
    setClaimState({ kind: "idle" });
    setConnectionState({ kind: "connecting" });
    qrCloseShouldResetRef.current = false;
    qrClosedWithoutConnectionRef.current = false;

    try {
      const connectedAddress = await connectTonalliWallet((uri) => {
        setWalletUri(uri);
        setManualWalletUri(null);
        setCopyState("idle");
        qrCloseShouldResetRef.current = true;
        QRCodeModal.open(uri, () => {
          if (!qrCloseShouldResetRef.current) return;
          qrClosedWithoutConnectionRef.current = true;
          qrCloseShouldResetRef.current = false;
          setWalletUri(null);
          setManualWalletUri(null);
          setCopyState("idle");
          setConnectionState({ kind: "idle" });
        });
        setConnectionState({ kind: isMobile ? "openWallet" : "waiting" });
      });

      qrCloseShouldResetRef.current = false;
      QRCodeModal.close();
      setAddress(connectedAddress);
      setWalletUri(null);
      setManualWalletUri(null);
      setCopyState("idle");
      setConnectionState({ kind: "connected" });
    } catch (error) {
      qrCloseShouldResetRef.current = false;
      QRCodeModal.close();
      if (qrClosedWithoutConnectionRef.current) {
        setWalletUri(null);
        setManualWalletUri(null);
        setCopyState("idle");
        setConnectionState({ kind: "idle" });
        return;
      }
      setConnectionState({
        kind: "error",
        message: error instanceof Error ? error.message : "No se pudo conectar wallet."
      });
    }
  }

  async function onCopyWalletUri() {
    if (!walletUri) return;
    try {
      await navigator.clipboard.writeText(walletUri);
      setManualWalletUri(null);
      setCopyState("copied");
    } catch {
      setManualWalletUri(walletUri);
      setCopyState("manual");
    }
  }

  async function pollTelegramSession(nonce: string) {
    try {
      const session = await getTelegramSession(nonce);
      if (session.expired) {
        stopTelegramPolling();
        setTelegramVerificationState("expired");
      } else if (session.verified) {
        stopTelegramPolling();
        setTelegramHandle(session.handle ?? "telegram-user");
        setTelegramVerificationState("verified");
      }
    } catch (error) {
      stopTelegramPolling();
      setTelegramError(error instanceof Error ? error.message : "No se pudo consultar Telegram.");
      setTelegramVerificationState("error");
    }
  }

  async function onStartTelegramVerification() {
    if (!address) return;
    stopTelegramPolling();
    setTelegramVerificationState("starting");
    setTelegramError("");
    setTelegramHandle("");
    try {
      const session = await createTelegramSession(address, eventCode);
      setTelegramNonce(session.nonce);
      setTelegramBotUrl(session.botUrl);
      setTelegramVerificationState("waiting");
      window.open(session.botUrl, "_blank", "noopener,noreferrer");
      pollingIntervalRef.current = setInterval(() => {
        void pollTelegramSession(session.nonce);
      }, 2000);
    } catch (error) {
      setTelegramError(error instanceof Error ? error.message : "No se pudo iniciar la verificación.");
      setTelegramVerificationState("error");
    }
  }

  async function onClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const loadingMessage = status?.telegramGateEnabled
      ? "Verificando Telegram y enviando XEC..."
      : status?.twitterGateEnabled
        ? "Verificando repost y enviando XEC..."
        : "Procesando claim...";
    setClaimState({ kind: "loading", message: loadingMessage });
    try {
      const result = await claimFaucet(
        status?.telegramGateEnabled
          ? { address, eventCode, provider: "telegram", telegramNonce }
          : status?.twitterGateEnabled
            ? { address, eventCode, provider: "x", twitterHandle }
            : { address, eventCode }
      );
      stopTelegramPolling();
      setClaimState({ kind: "success", txid: result.txid, claimCount: result.claimCount });
      setStatus(await getFaucetStatus());
      await disconnectTonalliWallet().catch((error) => {
        console.warn("No se pudo desconectar WalletConnect despues del claim", error);
      });
    } catch (error) {
      setClaimState({ kind: "error", message: error instanceof Error ? error.message : "No se pudo completar el claim." });
    }
  }

  const telegramClaimBlocked = status?.telegramGateEnabled === true &&
    (telegramVerificationState !== "verified" || !telegramNonce);

  return (
    <main className="page">
      <section className="panel" aria-labelledby="title">
        <div className="header">
          <p className="eyebrow">Tonalli Wallet / eCash Mexico</p>
          <h1 id="title">Faucet Tonalli</h1>
          <p className="subtitle">Recibe tus primeros XEC en Tonalli Wallet</p>
        </div>

        <div className="statusGrid">
          <div><span>Estado</span><strong>{status?.faucetEnabled ? "Activa" : "Pausada"}</strong></div>
          <div><span>Monto</span><strong>{status?.claimAmountXec ?? "500"} XEC</strong></div>
          <div><span>Claims</span><strong>{status?.totalClaims ?? 0}</strong></div>
        </div>

        <button className="primaryButton" type="button" onClick={onConnect} disabled={isBusy}>
          Conectar Tonalli Wallet
        </button>

        {isMobile && walletUri && walletDeepLink && connectionState.kind === "openWallet" && (
          <div className="walletConnectHelp">
            <div className="walletConnectActions">
              <a className="walletLink" href={walletDeepLink}>Abrir Tonalli Wallet</a>
              <button className="secondaryButton" type="button" onClick={onCopyWalletUri}>Copiar URI WalletConnect</button>
            </div>
            <p>Si el boton no abre Tonalli, copia el URI y pegalo en WalletConnect dentro de Tonalli.</p>
            {copyState === "copied" && <span className="copyStatus">URI copiado.</span>}
            {copyState === "manual" && (
              <textarea className="walletUriTextarea" value={manualWalletUri ?? walletUri} readOnly aria-label="URI WalletConnect" />
            )}
          </div>
        )}

        {connectionStatus && (
          <div className={`notice connection ${connectionState.kind === "error" ? "error" : "loading"}`}>
            <p>{connectionStatus}</p>
            {connectionState.kind === "error" && <span>{connectionState.message}</span>}
          </div>
        )}

        {address && <div className="addressBox"><span>Direccion conectada</span><code>{address}</code></div>}

        <form className="claimForm" onSubmit={onClaim}>
          <label htmlFor="eventCode">Codigo de evento</label>
          <input
            id="eventCode"
            className="eventCodeInput"
            value={eventCode}
            onChange={(event) => {
              setEventCode(event.target.value);
              if (telegramVerificationState !== "idle") resetTelegramVerification();
            }}
            placeholder="TONALLI-CU"
            autoCapitalize="characters"
          />

          {status?.telegramGateEnabled && (
            <section className="socialGateNotice" aria-labelledby="telegramGateTitle">
              <strong id="telegramGateTitle">Verificación Telegram</strong>
              <p className="hint">Tu cuenta se valida de forma segura mediante el bot de Telegram.</p>
              <div className="telegramGateActions">
                {status.telegramTargetChatUrl && (
                  <a className="officialPostLink" href={status.telegramTargetChatUrl} target="_blank" rel="noreferrer">
                    Únete al canal oficial
                  </a>
                )}
                <button
                  className="secondaryButton"
                  type="button"
                  onClick={onStartTelegramVerification}
                  disabled={!address || isBusy || telegramVerificationState === "starting"}
                >
                  {telegramVerificationState === "starting" ? "Generando enlace..." : "Verificar con Telegram"}
                </button>
                {telegramBotUrl && telegramVerificationState === "waiting" && (
                  <a className="officialPostLink" href={telegramBotUrl} target="_blank" rel="noreferrer">Abrir bot de Telegram</a>
                )}
              </div>
              {telegramVerificationState === "waiting" && (
                <p className="telegramStatus">Abre el bot de Telegram y presiona Start. Después vuelve aquí.</p>
              )}
              {telegramVerificationState === "verified" && (
                <p className="telegramStatus successText">Telegram verificado como {telegramHandle}</p>
              )}
              {telegramVerificationState === "expired" && (
                <p className="telegramStatus errorText">La verificación expiró. Genera una nueva.</p>
              )}
              {telegramVerificationState === "error" && (
                <p className="telegramStatus errorText">{telegramError}</p>
              )}
            </section>
          )}

          {!status?.telegramGateEnabled && status?.twitterGateEnabled && (
            <>
              <label htmlFor="twitterHandle">Tu usuario de X</label>
              <input id="twitterHandle" value={twitterHandle} onChange={(event) => setTwitterHandle(event.target.value)} placeholder="@xolosarmy" autoCapitalize="none" required />
              <p className="formHelp">Haz repost al post oficial para recibir tu premio.</p>
              {status.twitterTargetTweetUrl && (
                <a className="officialPostLink" href={status.twitterTargetTweetUrl} target="_blank" rel="noreferrer">Ver post oficial</a>
              )}
            </>
          )}

          <button
            className="claimButton"
            type="submit"
            disabled={
              !address || isBusy || telegramClaimBlocked ||
              (!status?.telegramGateEnabled && status?.twitterGateEnabled === true && !twitterHandle.trim())
            }
          >
            Recibir XEC
          </button>
        </form>

        {claimState.kind === "loading" && <p className="notice loading">{claimState.message}</p>}
        {claimState.kind === "error" && <p className="notice error">{claimState.message}</p>}
        {claimState.kind === "success" && (
          <div className="notice success">
            <p>Claim enviado. Claim #{claimState.claimCount}</p>
            <a href={`https://explorer.xolosarmy.xyz/tx/${claimState.txid}`} target="_blank" rel="noreferrer">Ver transacción en Xolos Explorer</a>
          </div>
        )}
      </section>
    </main>
  );
}
