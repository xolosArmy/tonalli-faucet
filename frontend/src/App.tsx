import { FormEvent, useEffect, useState } from "react";
import { claimFaucet, getFaucetStatus, type FaucetStatus } from "./api/faucet.js";
import { connectTonalliWallet } from "./walletconnect/client.js";

type ClaimState =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "success"; txid: string; claimCount: number }
  | { kind: "error"; message: string };

export default function App() {
  const [address, setAddress] = useState("");
  const [eventCode, setEventCode] = useState("TONALLI-CU");
  const [status, setStatus] = useState<FaucetStatus | null>(null);
  const [claimState, setClaimState] = useState<ClaimState>({ kind: "idle" });

  useEffect(() => {
    getFaucetStatus()
      .then(setStatus)
      .catch((error) => setClaimState({ kind: "error", message: error.message }));
  }, []);

  async function onConnect() {
    setClaimState({ kind: "loading", message: "Conectando Tonalli Wallet..." });
    try {
      const connectedAddress = await connectTonalliWallet();
      setAddress(connectedAddress);
      setClaimState({ kind: "idle" });
    } catch (error) {
      setClaimState({ kind: "error", message: error instanceof Error ? error.message : "No se pudo conectar wallet." });
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

        <button className="primaryButton" type="button" onClick={onConnect} disabled={claimState.kind === "loading"}>
          Conectar Tonalli Wallet
        </button>

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

          <button className="claimButton" type="submit" disabled={!address || claimState.kind === "loading"}>
            Recibir XEC
          </button>
        </form>

        {claimState.kind === "loading" && <p className="notice loading">{claimState.message}</p>}
        {claimState.kind === "error" && <p className="notice error">{claimState.message}</p>}
        {claimState.kind === "success" && (
          <div className="notice success">
            <p>Claim completado. Claim #{claimState.claimCount}</p>
            <a href={`https://explorer.e.cash/tx/${claimState.txid}`} target="_blank" rel="noreferrer">
              Ver txid
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
