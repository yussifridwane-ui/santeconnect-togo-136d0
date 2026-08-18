"use client";

/* ════════════════════════════════════════════════════════════════════
   ▦ V3.1.3 — SCANNER DOUBLE MOTEUR (cartes d'assurance maladie)
   MOTEUR 1 « rapide » : BarcodeDetector natif du navigateur, écoutant
     QR + PDF417 + DataMatrix + Aztec + Code128/39 + EAN/UPC + Codabar
     + ITF, filtré par getSupportedFormats().
   MOTEUR 2 « universel » : ZXing (librairie embarquée /vendor/zxing.min.js)
     prend le relais automatiquement si le natif est absent, incomplet
     ou muet après quelques secondes — lit PDF417/Code128 sur TOUS les
     téléphones, 100% local, AUCUNE image ne quitte l'appareil.
   Dès qu'un code entre dans le cadre → contenu renvoyé au formulaire.
   ════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from "react";
import { X, ScanLine, Loader2, AlertTriangle } from "lucide-react";

const WANTED = [
  "qr_code", "pdf417", "data_matrix", "aztec",
  "code_128", "code_39", "ean_13", "upc_a", "codabar", "itf",
];

type NativeDetector = new (opts?: { formats?: string[] }) => {
  detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

type ZxingResult = { getText: () => string };
type ZxingReader = {
  decodeFromVideoElement: (
    video: HTMLVideoElement,
    cb: (result: ZxingResult | undefined, err?: unknown) => void,
  ) => Promise<unknown>;
  reset: () => void;
};
type ZxingGlobal = {
  BrowserMultiFormatReader: new (
    hints?: Map<number, unknown>,
    timeBetweenAttemptsMs?: number,
  ) => ZxingReader;
  BarcodeFormat: Record<string, number>;
  DecodeHintType: Record<string, number>;
};

function loadZxing(): Promise<boolean> {
  return new Promise((resolve) => {
    const w = window as unknown as { ZXing?: ZxingGlobal };
    if (w.ZXing) return resolve(true);
    const s = document.createElement("script");
    s.src = "/vendor/zxing.min.js";
    s.async = true;
    s.onload = () => resolve(!!(window as unknown as { ZXing?: ZxingGlobal }).ZXing);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

export default function QrScannerModal({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [engine, setEngine] = useState<"boot" | "native" | "zxing">("boot");
  const stoppedRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let upgrade: ReturnType<typeof setTimeout> | null = null;
    let zxingReader: ZxingReader | null = null;
    stoppedRef.current = false;

    const deliver = (text: string) => {
      if (stoppedRef.current) return;
      stopAll();
      onResult(text.slice(0, 2000));
    };

    const stopAll = () => {
      stoppedRef.current = true;
      if (timer) clearInterval(timer);
      if (upgrade) clearTimeout(upgrade);
      try { zxingReader?.reset(); } catch { /* ignore */ }
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };

    /* ── MOTEUR 2 : ZXing universel (relai automatique) ─────────────── */
    const startZxing = async (video: HTMLVideoElement) => {
      const ok = await loadZxing();
      if (stoppedRef.current) return;
      if (!ok) {
        setError(
          "Lecture avancée indisponible (fichier moteur inaccessible). " +
          "Photographie simplement la carte à la place.",
        );
        return;
      }
      const ZX = (window as unknown as { ZXing: ZxingGlobal }).ZXing;
      if (timer) { clearInterval(timer); timer = null; } // on coupe le natif
      try {
        const F = ZX.BarcodeFormat;
        const formats = [
          F.QR_CODE, F.PDF_417, F.DATA_MATRIX, F.AZTEC,
          F.CODE_128, F.CODE_39, F.EAN_13, F.UPC_A, F.CODABAR, F.ITF,
        ].filter((v) => typeof v === "number");
        const hints = new Map<number, unknown>();
        hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, formats);
        hints.set(ZX.DecodeHintType.TRY_HARDER, true);
        zxingReader = new ZX.BrowserMultiFormatReader(hints, 150);
        setEngine("zxing");
        await zxingReader.decodeFromVideoElement(video, (result) => {
          if (result) deliver(String(result.getText()));
        });
      } catch {
        if (!stoppedRef.current) {
          setError("Le lecteur universel n'a pas pu démarrer. Photographie la carte à la place.");
        }
      }
    };

    /* ── DÉMARRAGE : caméra + moteur natif multi-formats si possible ── */
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Caméra inaccessible ici (il faut une page sécurisée https). Photographie la carte à la place.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" }, // caméra ARRIÈRE (le dos de la carte)
          audio: false,
        });
        const video = videoRef.current;
        if (!video || stoppedRef.current) { stopAll(); return; }
        video.srcObject = stream;
        await video.play();
        setReady(true);

        const BD = (window as unknown as {
          BarcodeDetector?: NativeDetector & {
            getSupportedFormats?: () => Promise<string[]>;
          };
        }).BarcodeDetector;

        let usable: string[] = [];
        if (BD) {
          try {
            const sup = (await BD.getSupportedFormats?.()) ?? WANTED;
            usable = WANTED.filter((f) => sup.includes(f));
          } catch {
            usable = WANTED; // navigateur muet sur ses capacités → on tente tout
          }
        }

        if (BD && usable.length > 0) {
          /* MOTEUR 1 : natif rapide — mais relais ZXing armé si muet */
          setEngine("native");
          const detector = new BD({ formats: usable });
          timer = setInterval(async () => {
            if (stoppedRef.current || !videoRef.current) return;
            try {
              const codes = await detector.detect(videoRef.current);
              if (codes.length > 0 && codes[0].rawValue) {
                deliver(String(codes[0].rawValue));
              }
            } catch { /* frame illisible → on continue */ }
          }, 250);
          if (!usable.includes("pdf417") || !usable.includes("code_128")) {
            /* le natif ne couvre pas les codes des cartes → ZXing tout de suite */
            void startZxing(video);
          } else {
            /* couverture complète promises… mais certains téléphones bluffent :
               si rien après 6 s, on passe la main à ZXing automatiquement */
            upgrade = setTimeout(() => { void startZxing(video); }, 6000);
          }
        } else {
          /* pas de BarcodeDetector (ex. iPhone) → moteur universel direct */
          void startZxing(video);
        }
      } catch {
        setError(
          "Caméra refusée ou indisponible. Autorise l'accès caméra quand le téléphone le demande — ou photographie la carte.",
        );
      }
    };

    start();
    return stopAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <ScanLine size={18} className="text-indigo-600" />
          <p className="font-bold text-gray-900 text-sm">Scanner la carte</p>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
            title="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4">
          {error ? (
            <div className="flex items-start gap-2.5 p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
              <AlertTriangle size={17} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          ) : (
            <>
              <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
                <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
                {!ready && (
                  <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm gap-2">
                    <Loader2 size={18} className="animate-spin" /> Démarrage de la caméra…
                  </div>
                )}
                {/* Cadre de visée */}
                <div className="absolute inset-6 border-2 border-emerald-400/80 rounded-xl pointer-events-none" />
              </div>
              <p className="text-[11px] text-center mt-2 font-medium text-emerald-700">
                {engine === "zxing"
                  ? "🛡️ Lecture universelle activée — tous formats de codes"
                  : engine === "native"
                    ? "⚡ Lecture rapide — passage automatique en mode universel si besoin"
                    : "⏳ Préparation du lecteur…"}
              </p>
              <p className="text-xs text-gray-500 text-center mt-1.5">
                📇 Cadrez le <b>QR code</b> ou le <b>code-barres rectangulaire</b> (PDF417) au dos de la
                carte, à <b>10–15 cm</b>, bien en lumière — la lecture est <b>automatique</b> et reste
                sur votre appareil.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
