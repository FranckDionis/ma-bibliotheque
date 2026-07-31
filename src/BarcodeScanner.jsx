import React, { useState, useEffect, useRef } from "react";
import { Camera, Loader2 } from "lucide-react";
import { loadZXing, createConfiguredReader } from "./lecteurCodeBarres";

// Scanner simple : un code, puis on rend la main.

// === SCANNER CODE-BARRES ===
export function BarcodeScanner({ onCancel, onScan, searching }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const [error, setError] = useState(null);
  const [manualISBN, setManualISBN] = useState("");
  const [scanning, setScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [diagLogs, setDiagLogs] = useState([]);
  const fired = useRef(false);

  const log = (msg) => {
    console.log("[scan]", msg);
    setDiagLogs((logs) => [...logs, `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  // Démarrage explicite par tap utilisateur (essentiel pour iOS standalone)
  const handleStart = async () => {
    setStarting(true);
    setError(null);
    setDiagLogs([]);
    fired.current = false;
    log("Bouton tapé, démarrage…");
    try {
      // Test 1: API getUserMedia disponible ?
      if (!navigator.mediaDevices?.getUserMedia) {
        log("❌ navigator.mediaDevices.getUserMedia indisponible");
        setError("API caméra indisponible — utilisez Safari (pas une autre app)");
        setStarting(false);
        return;
      }
      log("✅ API getUserMedia disponible");

      // Test 2: HTTPS ?
      log(`Protocole: ${location.protocol} (${location.hostname})`);

      // Test 3: Tentative directe getUserMedia AVANT ZXing
      log("Demande accès caméra…");
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        log(`✅ Caméra obtenue, ${stream.getVideoTracks().length} pistes`);
        const track = stream.getVideoTracks()[0];
        if (track) log(`   Piste : ${track.label || "(sans label)"} — ${track.readyState}`);
      } catch (e) {
        log(`❌ getUserMedia échoue: ${e.name} — ${e.message}`);
        if (e.name === "NotAllowedError") setError("permission");
        else setError(`${e.name}: ${e.message}`);
        setStarting(false);
        return;
      }

      // Test 4: Attache à la balise vidéo
      if (!videoRef.current) {
        log("❌ <video> introuvable");
        stream.getTracks().forEach((t) => t.stop());
        setError("Élément vidéo manquant");
        setStarting(false);
        return;
      }
      videoRef.current.srcObject = stream;
      videoRef.current.setAttribute("playsinline", "true");
      videoRef.current.muted = true;
      log("Stream attaché à <video>");

      // Test 5: Lecture de la vidéo
      try {
        await videoRef.current.play();
        log(`✅ video.play() OK (${videoRef.current.videoWidth}x${videoRef.current.videoHeight})`);
      } catch (e) {
        log(`⚠️ video.play() : ${e.name} — ${e.message}`);
      }

      // À ce stade, si on voit la caméra c'est gagné. Maintenant ZXing.
      // Le module est chargé ici plutôt que dans le bloc suivant : on veut
      // distinguer, dans le journal de diagnostic, un échec de
      // TÉLÉCHARGEMENT du module d'un échec de démarrage du décodage.
      log("Initialisation de ZXing…");
      try {
        await loadZXing();
        log("✅ ZXing prêt");
      } catch (e) {
        log(`❌ ZXing échoue: ${e.message}`);
        setError(`Lecteur de codes-barres indisponible : ${e.message}`);
        setStarting(false);
        return;
      }

      // Test 6: Démarrer ZXing sur la vidéo déjà active
      try {
        const reader = await createConfiguredReader();
        const controls = reader.decodeFromVideoElement(videoRef.current, (result) => {
          if (result) {
            const code = result.getText();
            // Accepte tout EAN-13, EAN-12 (UPC-A), EAN-11 ou ISBN-10
            if (!/^\d{10,13}$/.test(code)) return;
            if (fired.current) return;
            fired.current = true;
            try { controls.stop(); } catch (e) {}
            try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
            onScan(code);
          }
        });
        readerRef.current = { stop: () => {
          try { controls.stop(); } catch (e) {}
          try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
        }};
        log("✅ ZXing en écoute");
        setScanning(true);
      } catch (e) {
        log(`❌ ZXing decodeFromVideoElement: ${e.message}`);
        setError(`Décodage: ${e.message}`);
      }
    } catch (e) {
      log(`❌ Erreur globale: ${e.message}`);
      setError(e?.message || "camera");
    }
    setStarting(false);
  };

  // Stop à la sortie
  useEffect(() => {
    return () => {
      if (readerRef.current) {
        try { readerRef.current.stop(); } catch (err) { /* ignore */ }
      }
    };
  }, []);

  if (error === "not-supported") {
    return (
      <div className="text-center pt-8">
        <p style={{ color: "var(--ink)", marginBottom: "1rem" }}>
          Le scan automatique n'est pas pris en charge par votre navigateur. Saisissez l'ISBN à la main (au dos du livre, 13 chiffres) :
        </p>
        <input
          type="tel"
          value={manualISBN}
          onChange={(e) => setManualISBN(e.target.value.replace(/\D/g, ""))}
          placeholder="978…"
          maxLength={13}
          className="w-full p-3 rounded-xl border-2 outline-none mb-3"
          style={{ borderColor: "var(--parchment)" }}
        />
        <button
          onClick={() => manualISBN.length >= 10 && onScan(manualISBN)}
          disabled={manualISBN.length < 10 || searching}
          className="w-full py-3 rounded-xl font-medium disabled:opacity-50"
          style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
        >
          {searching ? "Recherche…" : "Rechercher ce livre"}
        </button>
      </div>
    );
  }

  if (error === "permission") {
    return (
      <div className="text-center pt-8 px-4">
        <p style={{ color: "var(--accent)", fontWeight: "600", marginBottom: "0.5rem" }}>
          Accès à la caméra refusé
        </p>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.875rem", marginBottom: "1rem" }}>
          Allez dans Réglages iOS → Safari → Caméra pour autoriser l'accès, puis fermez et rouvrez l'app.
        </p>
        <button
          onClick={handleStart}
          className="px-4 py-2 rounded-lg font-medium"
          style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
        >
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-black">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          playsInline
          muted
          autoPlay
          webkit-playsinline="true"
        />

        {/* Overlay tant que la caméra n'est pas démarrée */}
        {!scanning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center"
            style={{ background: "rgba(74, 35, 10, 0.92)" }}>
            <Camera className="w-12 h-12 mb-3" style={{ color: "var(--gold-light)" }} />
            <p className="mb-4" style={{ color: "var(--cream)" }}>
              Touchez pour démarrer la caméra et scanner le code-barres
            </p>
            <button
              onClick={handleStart}
              disabled={starting}
              className="px-6 py-3 rounded-full font-medium disabled:opacity-50 flex items-center gap-2"
              style={{ background: "var(--gold-light)", color: "var(--leather-dark)" }}
            >
              {starting ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Démarrage…</>
              ) : (
                <><Camera className="w-5 h-5" /> Démarrer la caméra</>
              )}
            </button>
            {error && error !== "permission" && error !== "not-supported" && (
              <p className="text-xs mt-3" style={{ color: "var(--gold-light)" }}>
                Erreur : {error}
              </p>
            )}
          </div>
        )}

        {/* Cadre de scan */}
        {scanning && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-4/5 h-1/3 border-2 rounded-lg" style={{ borderColor: "var(--gold-light)" }}>
              <div className="absolute left-0 right-0 h-0.5 scan-line" style={{ background: "var(--gold-light)" }} />
            </div>
          </div>
        )}
        {searching && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" style={{ color: "var(--gold-light)" }} />
              <p style={{ color: "var(--cream)" }}>Recherche du livre…</p>
            </div>
          </div>
        )}
      </div>
      <p className="text-center mt-4 text-sm" style={{ color: "var(--ink-soft)" }}>
        {scanning ? "Pointez la caméra vers le code-barres au dos du livre" : "Touchez le bouton pour démarrer"}
      </p>

      {/* Panneau de diagnostic — visible si erreur ou tant que ça démarre */}
      {diagLogs.length > 0 && (
        <div className="mt-4 p-3 rounded-lg" style={{ background: "#1a1a1a", color: "#9fdc9f" }}>
          <div className="text-xs mb-2 font-bold" style={{ color: "#fff" }}>Diagnostic :</div>
          <div className="text-xs font-mono space-y-1" style={{ fontSize: "0.7rem", lineHeight: 1.4 }}>
            {diagLogs.map((line, i) => (
              <div key={i} style={{ wordBreak: "break-word" }}>{line}</div>
            ))}
          </div>
          <button
            onClick={() => {
              const text = diagLogs.join("\n");
              if (navigator.clipboard) navigator.clipboard.writeText(text);
            }}
            className="mt-2 px-2 py-1 rounded text-xs"
            style={{ background: "#444", color: "#fff" }}
          >
            Copier les logs
          </button>
        </div>
      )}
    </div>
  );
}
