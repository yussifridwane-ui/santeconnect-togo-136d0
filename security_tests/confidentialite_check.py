#!/usr/bin/env python3
"""Audit CONFIDENTIALITE SanteOnline : verifie qu'AUCUNE donnee patient ne fuit
sans authentification (anonyme) et que les erreurs ne divulguent rien."""
import urllib.request, urllib.error, json, ssl, sys

BASE = "https://santeonline.netlify.app"
ctx = ssl.create_default_context()
P = []
F = []

def probe(path, note="", expect=(401, 403, 404, 405), bad_words=None):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "audit-conf/1.0"})
    try:
        r = urllib.request.urlopen(req, timeout=20, context=ctx)
        code, body = r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        code, body = e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        F.append(f"{path} -> ERREUR RESEAU {e}"); return
    leak = []
    low = body.lower()
    for bad in (bad_words or []) + ["database_url", "postgres://", "password_hash",
                                     "\"stack\"", "node_modules", "/home/", "jwt_secret",
                                     "neon.tech", "bcrypt"]:
        if bad in low or bad in body:
            leak.append(bad)
    if code == 200:
        try:
            j = json.loads(body)
            txt = json.dumps(j, ensure_ascii=False).lower()
            for k in ("patients", "email", "@", "diagnost", "ordonnan", "telephone", "phone"):
                if k in txt:
                    leak.append(f"donnee-json:{k}")
        except Exception:
            pass
    if code in expect and not leak:
        P.append(f"{path} [{code}] {note}")
    else:
        F.append(f"{path} [{code}] {note} FUITES={leak or code}")

print("=== ACCES ANONYMES AUX DONNEES (doivent etre bloques 401/403) ===")
probe("/api/patients", "liste patients")
probe("/api/patients/1", "fiche patient")
probe("/api/patients/1/insurances", "assurances patient")
probe("/api/patients/1/documents", "documents patient")
probe("/api/patients/1/records", "dossiers medicaux")
probe("/api/records", "ordonnances")
probe("/api/appointments", "rendez-vous")
probe("/api/users", "utilisateurs")
probe("/api/audit", "journal audit")
probe("/api/insurers", "assureurs")
probe("/api/pharmacy", "pharmacie")
probe("/api/pharmacy/stock", "stock")
probe("/api/lab", "labo")
probe("/api/documents/1", "fichier document")
probe("/api/portal", "portail patient")
probe("/api/portal/dossier", "dossier portail")
probe("/api/billing", "facturation")
probe("/api/stats", "stats dashboard")

print("=== VERBOCITE DES ERREURS (pas de stack trace / secret) ===")
probe("/api/auth/login", "login GET", bad_words=["traceback", "at Object", "drizzle"])
probe("/api/%2e%2e/env", "traversal", expect=(400, 401, 403, 404, 500))
probe("/.env", "fichier .env")
probe("/api/swagger", "doc API")

print(f"\nRESULTAT: {len(P)} OK / {len(P)+len(F)}")
for x in F: print("  ALERTE:", x)
sys.exit(1 if F else 0)
