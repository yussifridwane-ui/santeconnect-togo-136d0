import { NextRequest, NextResponse } from "next/server";
import { getSession, setSession, rateLimit } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureMigrated } from "@/db/migrate";
import { audit } from "@/lib/audit";

/* ════════════════════════════════════════════════════════════════════
   👤 V3.2 — LE VRAI MOTEUR d'enregistrement du profil
   Avant : le bouton « Sauvegarder » des Paramètres était décoratif.
   Désormais : nom complet + téléphone réellement persistés en base.
   Sécurité : session obligatoire · on ne modifie QUE son propre compte
   (id pris depuis la session signée, JAMAIS depuis le corps de la
   requête) · validations strictes · garde-fou 20/h · audit « modifier »
   sans jamais journaliser de secret · l'email (= identifiant de
   connexion) reste volontairement non modifiable ici.
   ════════════════════════════════════════════════════════════════════ */

/* Noms togolais acceptés : lettres Unicode (accents OK), espace, point,
   tiret et apostrophes droite (\x27) + typographique (’) */
const NAME_RE = /^[\p{L}][\p{L} .\x27’-]{1,79}$/u;
const PHONE_RE = /^\+?[0-9][0-9 ()-]{5,18}$/;            // ex : +228 71 69 24 01

export async function PUT(req: NextRequest) {
  try {
    await ensureMigrated();
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }
    if (!rateLimit(`profile:${session.id}`, 20, 60 * 60 * 1000)) {
      return NextResponse.json(
        { error: "Trop de modifications d'affilée. Réessayez dans une heure." },
        { status: 429 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Requête illisible." }, { status: 400 });
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const fullName = String(b.fullName ?? "").trim().replace(/\s+/g, " ");
    const phone = String(b.phone ?? "").trim();

    if (!NAME_RE.test(fullName)) {
      return NextResponse.json(
        { error: "Le nom complet doit contenir 2 à 80 lettres (accents acceptés)." },
        { status: 400 },
      );
    }
    if (phone !== "" && !PHONE_RE.test(phone)) {
      return NextResponse.json(
        { error: "Numéro de téléphone invalide (ex. : +228 71 69 24 01)." },
        { status: 400 },
      );
    }

    await db
      .update(users)
      .set({ fullName, phone, updatedAt: new Date() })
      .where(eq(users.id, session.id));

    /* Le nom affiché vit dans le jeton de session → on le rebadge aussitôt */
    await setSession({
      id: session.id,
      fullName,
      email: session.email,
      role: session.role,
      facilityId: session.facilityId,
    });

    const fresh = { ...session, fullName };
    await audit(fresh, {
      action: "modifier",
      entity: "utilisateur",
      entityId: session.id,
      detail: "Mise à jour du profil (nom complet / téléphone)",
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[profile PUT]", e);
    return NextResponse.json(
      { error: "Erreur serveur. Réessayez dans un instant." },
      { status: 500 },
    );
  }
}
