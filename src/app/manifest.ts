import type { MetadataRoute } from "next";

/* 📱 V3.2 — Manifeste PWA SantéOnline
   « Ajouter à l'écran d'accueil » sur téléphone → vraie icône officielle
   (cœur + pulsation) + nom complet + ouverture en plein écran. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SantéOnline — Gestion hospitalière",
    short_name: "SantéOnline",
    description:
      "La santé togolaise, connectée : dossiers patients, rendez-vous, ordonnances, assurances maladie.",
    start_url: "/",
    display: "standalone",
    background_color: "#064e3b",
    theme_color: "#065f46",
    lang: "fr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
