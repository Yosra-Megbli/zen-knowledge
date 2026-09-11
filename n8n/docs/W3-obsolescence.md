# W3 — Workflow d'obsolescence ZEN Knowledge

## Objectif

Faire respecter automatiquement la date de révision (`review_date`) d'un
document publié, sans dépendre d'un humain qui s'en souvient :

1. **Avertir** (warning) quand `review_date` approche (< `warningDays`).
2. **Rappeler** (overdue) tant que la date est dépassée mais dans la
   période de grâce (`graceDays`).
3. **Dépublier automatiquement** (unpublish) une fois la période de
   grâce écoulée — le document redevient immédiatement introuvable en
   RAG, exactement comme si un admin l'avait dépublié à la main.

C'est le symétrique de « Upload ≠ Published » (W1/Phase 4) : ici,
**Published ≠ Published pour toujours** — la publication reste valide
seulement tant qu'elle est à jour.

## Déclencheur

Schedule Trigger (cron), **pas** un webhook — W3 est un job planifié,
pas une action déclenchée par un utilisateur.

Cron par défaut : `0 8 * * *` (tous les jours à 08:00).

## Étapes du workflow

```
1. Daily 08:00 — Review Scan (Schedule Trigger)

2. Call ZEN Review-Due API (HTTP Request)
   GET /api/n8n/review-due?warningDays=7&graceDays=30
   Retourne tous les documents publiés dont review_date approche/est dépassée,
   toutes companies confondues (scan administratif cross-company).

3. Scan OK? (If — statusCode == 200)

4a. Split Documents (Code)
    Transforme le tableau `items` en items n8n individuels,
    un par document, pour un routage indépendant.

4b. Log Scan Error (Code) — branche d'échec, ne bloque pas les runs suivants.

5. Past Grace Period? (If — classification == 'unpublish')

6a. Call ZEN Unpublish API (HTTP Request)
    POST /api/n8n/unpublish — document past grace period.

6b. Call ZEN Notify API (HTTP Request)
    POST /api/n8n/review-due/notify — document 'warning' ou 'overdue'.

7a/7b. Build Unpublish Result / Build Notify Result (Code)
    Normalise chaque résultat pour l'agrégation finale.

8. Merge Results → 9. Summarize Run (Code)
   Compte notified / unpublished / failed, log le résumé du run.
```

## Contrat API

### GET /api/n8n/review-due

Déjà en place depuis la fondation W3 (voir `app/api/n8n/review-due/route.ts`).

**Headers**
```
X-N8N-Secret: <N8N_WEBHOOK_SECRET>
```

**Query params**
- `warningDays` (défaut 7) — jours avant `review_date` pour commencer à avertir
- `graceDays` (défaut 30) — jours après `review_date` avant dépublication

**Réponse (200)**
```json
{
  "items": [
    {
      "document_id": "uuid",
      "company_id": "uuid",
      "title": "Politique de télétravail 2024",
      "review_date": "2024-01-01",
      "days_past_due": 35,
      "owner_id": "uuid",
      "owner_email": "admin@acmecorp.example",
      "task_id": "uuid | null",
      "task_status": "warning | overdue | null",
      "classification": "warning | overdue | unpublish"
    }
  ],
  "count": 1,
  "warningDays": 7,
  "graceDays": 30,
  "scannedAt": "2024-02-05T08:00:00.000Z"
}
```

Utilise `w3_get_review_due_documents()` (fonction `SECURITY DEFINER`,
migration `0016`) — nécessaire car ce scan est cross-company par
nature (un cron administratif), ce que RLS interdirait sinon pour
`app_role`. Retourne uniquement des colonnes d'identité/métadonnées,
jamais le contenu du document.

### POST /api/n8n/review-due/notify

Crée ou met à jour la tâche de suivi (`review_tasks`) pour un document
classé `warning` ou `overdue`.

**Body**
```json
{
  "documentId": "uuid",
  "reviewDate": "2024-01-01",
  "classification": "warning"
}
```

`companyId`/`ownerId` ne sont **jamais** acceptés dans le body — ils
sont résolus depuis la DB via `w3_resolve_document_for_task()`
(migration `0017`, même principe que `auth_find_user_by_email` côté
W1). Seul `documentId` (renvoyé par le scan GET) est repris tel quel.

Un index unique partiel (`review_tasks_one_open_per_document`,
migration `0015`) garantit qu'il n'existe **jamais** plus d'une tâche
ouverte par document : un second appel (warning → overdue) met à jour
la même ligne (`reminded_at`) au lieu d'en créer une nouvelle.

**Réponse (200)**
```json
{
  "ok": true,
  "task": {
    "id": "uuid",
    "status": "overdue",
    "due_date": "2024-01-01",
    "notified_at": "2024-01-25T08:00:00.000Z",
    "reminded_at": "2024-02-05T08:00:00.000Z"
  }
}
```

### POST /api/n8n/unpublish

Dépublie un document dont la période de grâce est dépassée
(`classification: "unpublish"`).

**Body**
```json
{ "documentId": "uuid" }
```

Même principe de résolution serveur que `/notify` : `companyId`/
`ownerId` viennent de `w3_resolve_document_for_task()`, jamais du
body. Appelle `unpublishDocument()` (`lib/ingestion/pipeline/unpublishDocument.ts`) :
- `documents.status` → `unpublished`
- `document_versions.status` (version courante) → `archived`
- Les triggers de propagation (migration `0008`/`0013`) rendent les
  chunks immédiatement non récupérables — mêmes garanties que pour
  n'importe quelle dépublication.
- La tâche `review_tasks` ouverte est marquée `unpublished` (best-effort,
  non bloquant : si cette écriture échoue, le document reste
  correctement dépublié — c'est la propriété de sécurité qui compte).

**Réponse (200)**
```json
{ "ok": true, "documentId": "uuid", "documentVersionId": "uuid", "status": "unpublished" }
```

**Réponse erreur (404)** — document introuvable ou déjà non publié :
```json
{ "error": "document not found or not currently published" }
```

## Pourquoi `unpublishDocument()` ne vérifie pas `ctx.role`

`publishVersion()` refuse un `role: 'employee'` — c'est une protection
contre une requête **initiée par un utilisateur** (n'importe quel
employé authentifié tapant l'API directement). `unpublishDocument()`
n'est atteignable que via `POST /api/n8n/unpublish`, protégée par le
secret partagé `N8N_WEBHOOK_SECRET` — une frontière de confiance
différente (l'appelant est le cron n8n de confiance, pas un
utilisateur arbitraire). Exiger en plus que le contexte résolu soit
`admin` ferait échouer silencieusement l'obsolescence automatique dès
qu'un document appartient à un employé — un bug logique, pas une
propriété de sécurité supplémentaire utile ici.

## Import du workflow dans n8n

1. Ouvrir n8n → Menu → Import from file
2. Sélectionner `n8n/workflows/W3-obsolescence.json`
3. Réutiliser le credential **HTTP Header Auth** déjà créé pour W1
   (`ZEN Webhook Secret` — header `X-N8N-Secret`), ou le recréer :
   - Name : `ZEN Webhook Secret`
   - Header Name : `X-N8N-Secret`
   - Header Value : valeur de `N8N_WEBHOOK_SECRET` depuis `.env.local`
4. Vérifier que `ZEN_APP_URL` est défini (même variable que W1) :
   - Local : `http://host.docker.internal:3000`
   - Prod : `https://zen-knowledge.vercel.app`
5. Ajuster le cron du node **Daily 08:00 — Review Scan** si besoin
   (démo : déclenchement manuel via "Execute Workflow" plutôt que
   d'attendre le cron)
6. Activer le workflow

## Variables / credentials nécessaires

| Nom | Type | Valeur |
|-----|------|--------|
| `ZEN_APP_URL` | Env var n8n | URL de l'app Next.js (partagée avec W1) — déjà définie dans `docker-compose.yml` |
| `ZEN Webhook Secret` | Credential n8n (HTTP Header Auth) | `N8N_WEBHOOK_SECRET` (partagé avec W1) |
| `N8N_WEBHOOK_SECRET` | Env var Next.js | Secret partagé (min 32 chars) |

Voir la section "Pièges rencontrés" dans `n8n/docs/W1-ingestion.md` —
`N8N_BLOCK_ENV_ACCESS_IN_NODE` et le champ `"id"` requis s'appliquent
également à ce workflow.

## Tests automatisés

`tests/integration/ingestion/w3.test.ts` couvre la logique métier
derrière les deux nouvelles routes (pas le JSON du workflow n8n
lui-même, qui n'est pas exécutable en dehors de n8n) :
- `unpublishDocument()` inverse bien `publishVersion()` (document/version/chunks)
- rejet si le document n'est pas actuellement publié
- `w3_resolve_document_for_task()` renvoie les bonnes valeurs et rien pour un id inconnu
- l'upsert `review_tasks` ne crée jamais de doublon (index unique partiel)
