import QRCodeModal from "@walletconnect/qrcode-modal";
import { FormEvent, useEffect, useRef, useState } from "react";
import { claimFaucet, getFaucetStatus, type FaucetStatus } from "./api/faucet.js";
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

function isMobileUserAgent(userAgent: string): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
}

function connectionLabel(state: ConnectionState): string | null {
  switch (state.kind) {
    case "connecting":
      return "Conectando";
    case "waiting":
      return "Esperando conexion";
    case "openWallet":
      return "Abre Tonalli Wallet";
    case "connected":
      return "Direccion conectada";
    case "error":
      return "Error";
    default:
      return null;
  }
}

export default function App() {
  const [address, setAddress] = useState("");
  const [eventCode, setEventCode] = useState("TONALLI-CU");
  const [status, setStatus] = useState<FaucetStatus | null>(null);
  const [claimState, setClaimState] = useState<ClaimState>({ kind: "idle" });
  const [connectionState, setConnectionState] = useState<ConnectionState>({ kind: "idle" });
  const [walletUri, setWalletUri] = useState<string | null>(null);
  const [manualWalletUri, setManualWalletUri] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const [isMobile] = useState(() => isMobileUserAgent(window.navigator.userAgent));
  const qrCloseShouldResetRef = useRef(false);
  const qrClosedWithoutConnectionRef = useRef(false);

  const walletDeepLink = walletUri ? `tonalli://wc?uri=${encodeURIComponent(walletUri)}` : null;
  const connectionStatus = connectionLabel(connectionState);
  const isBusy =
    claimState.kind === "loading" ||
    connectionState.kind === "connecting" ||
    connectionState.kind === "waiting" ||
    connectionState.kind === "openWallet";

  useEffect(() => {
    getFaucetStatus()
      .then(setStatus)
      .catch((error) => setClaimState({ kind: "error", message: error.message }));
  }, []);

  async function onConnect() {
    setWalletUri(null);
    setManualWalletUri(null);
    setCopyState("idle");
    setAddress("");
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

        if (isMobile) {
          setConnectionState({ kind: "openWallet" });
          return;
        }

        setConnectionState({ kind: "waiting" });
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

  async function onClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setClaimState({ kind: "loading", message: "Procesando claim..." });
    try {
      const result = await claimFaucet(address, eventCode);
      setClaimState({ kind: "success", txid: result.txid, claimCount: result.claimCount });
      const nextStatus = await getFaucetStatus();
      setStatus(nextStatus);
      await disconnectTonalliWallet().catch((error) => {
        console.warn("No se pudo desconectar WalletConnect despues del claim", error);
      });
    } catch (error) {
      setClaimState({ kind: "error", message: error instanceof Error ? error.message : "No se pudo completar el claim." });
    }
  }

  return (
    <main className="page">
      <section className="panel" aria-labelledby="title">
        <div className="header">
          <p className="eyebrow">Tonalli Wallet / eCash Mexico</p>
          <h1 id="title">Faucet Tonalli</h1>
          <p className="subtitle">Recibe tus primeros XEC en Tonalli Wallet</p>
        </div>

        <div className="statusGrid">
          <div>
            <span>Estado</span>
            <strong>{status?.faucetEnabled ? "Activa" : "Pausada"}</strong>
          </div>
          <div>
            <span>Monto</span>
            <strong>{status?.claimAmountXec ?? "500"} XEC</strong>
          </div>
          <div>
            <span>Claims</span>
            <strong>{status?.totalClaims ?? 0}</strong>
          </div>
        </div>

        <button className="primaryButton" type="button" onClick={onConnect} disabled={isBusy}>
          Conectar Tonalli Wallet
        </button>

        {isMobile && walletUri && walletDeepLink && connectionState.kind === "openWallet" && (
          <div className="walletConnectHelp">
            <div className="walletConnectActions">
              <a className="walletLink" href={walletDeepLink}>
                Abrir Tonalli Wallet
              </a>
              <button className="secondaryButton" type="button" onClick={onCopyWalletUri}>
                Copiar URI WalletConnect
              </button>
            </div>
            <p>Si el boton no abre Tonalli, copia el URI y pegalo en WalletConnect dentro de Tonalli.</p>
            {copyState === "copied" && <span className="copyStatus">URI copiado.</span>}
            {copyState === "manual" && (
              <textarea
                className="walletUriTextarea"
                value={manualWalletUri ?? walletUri}
                readOnly
                aria-label="URI WalletConnect"
              />
            )}
          </div>
        )}

        {connectionStatus && (
          <div className={`notice connection ${connectionState.kind === "error" ? "error" : "loading"}`}>
            <p>{connectionStatus}</p>
            {connectionState.kind === "error" && <span>{connectionState.message}</span>}
          </div>
        )}

        {address && (
          <div className="addressBox">
            <span>Direccion conectada</span>
            <code>{address}</code>
          </div>
        )}

        <form className="claimForm" onSubmit={onClaim}>
          <label htmlFor="eventCode">Codigo de evento</label>
          <input
            id="eventCode"
            value={eventCode}
            onChange={(event) => setEventCode(event.target.value)}
            placeholder="TONALLI-CU"
            autoCapitalize="characters"
          />

          <button className="claimButton" type="submit" disabled={!address || isBusy}>
            Recibir XEC
          </button>
        </form>

        {claimState.kind === "loading" && <p className="notice loading">{claimState.message}</p>}
        {claimState.kind === "error" && <p className="notice error">{claimState.message}</p>}
        {claimState.kind === "success" && (
          <div className="notice success">
            <p>Claim enviado. Claim #{claimState.claimCount}</p>
            <a href={`https://explorer.e.cash/tx/${claimState.txid}`} target="_blank" rel="noreferrer">
              Ver txid
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
