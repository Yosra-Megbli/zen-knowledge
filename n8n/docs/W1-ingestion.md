# W1 — Workflow d'ingestion ZEN Knowledge

## Objectif

Orchestrer l'ingestion d'un document dans ZEN Knowledge via n8n.
Le workflow reçoit un fichier encodé en base64, le transmet à l'API
d'ingestion existante, et retourne un résultat structuré (succès ou
erreur). **Le document n'est jamais publié automatiquement** — la
publication reste une action explicite séparée.

## Déclencheur

Webhook HTTP `POST` sur le path `zen-ingest`.

URL locale : `http://localhost:5678/webhook/zen-ingest`
URL prod n8n : `https://<n8n-host>/webhook/zen-ingest`

## Étapes du workflow

```
1. Webhook — Receive Ingestion Request
   Reçoit la requête POST avec le fichier et les métadonnées.

2. Validate Input (Code node)
   Vérifie la présence des champs obligatoires.
   Ne transmet jamais company_id / role depuis le body.

3. Call ZEN Ingest API (HTTP Request node)
   POST /api/n8n/ingest avec le header X-N8N-Secret.
   Timeout : 120s (embeddings locaux peuvent être lents).

4. Success? (If node)
   Branche sur le code HTTP retourné (201 = succès, autre = erreur).

5a. Build Success Response (Code node)
    Construit la réponse structurée avec documentVersionId, chunkCount, etc.

5b. Build Error Response (Code node)
    Catégorise l'erreur (AUTH_ERROR, VALIDATION_ERROR, INGESTION_FAILED...).

6a. Respond — Success (201)
6b. Respond — Error (422)
```

## Contrat API — POST /api/n8n/ingest

### Headers requis
```
Content-Type: application/json
X-N8N-Secret: <N8N_WEBHOOK_SECRET>
```

### Body JSON
```json
{
  "email": "contributor@acmecorp.example",
  "fileName": "politique-teletravail.txt",
  "fileBase64": "<base64 du fichier>",
  "title": "Politique de télétravail 2024",
  "visibility": "company",
  "description": "Règles de télétravail AcmeCorp",
  "reviewDate": "2025-12-31",
  "departmentId": null,
  "documentId": null
}
```

Champs obligatoires : `email`, `fileName`, `fileBase64`, `title`, `visibility`

`company_id`, `role`, `department_id` ne sont **jamais** acceptés dans le body
— ils sont résolus depuis la DB via `auth_find_user_by_email()`.

### Réponse succès (201)
```json
{
  "ok": true,
  "status": "completed",
  "documentId": "uuid",
  "documentVersionId": "uuid",
  "ingestionJobId": "uuid",
  "chunkCount": 12,
  "published": false,
  "note": "Document is in 'ready' status. Explicit publication required.",
  "startedAt": "2024-01-15T10:00:00.000Z",
  "finishedAt": "2024-01-15T10:00:45.000Z"
}
```

### Réponse erreur (422)
```json
{
  "ok": false,
  "category": "INGESTION_FAILED",
  "httpStatus": 422,
  "error": "No usable text remained after cleaning.",
  "errorCode": "EMPTY_TEXT_AFTER_CLEANING",
  "startedAt": "...",
  "finishedAt": "..."
}
```

## Gestion des erreurs

| Catégorie | Cause | Code HTTP |
|-----------|-------|-----------|
| `AUTH_ERROR` | Secret invalide, user inactif, user sans company | 401/403 |
| `VALIDATION_ERROR` | Champ manquant, visibility invalide, fichier vide | 400 |
| `NOT_FOUND` | documentId inexistant ou autre company (RLS) | 404 |
| `INGESTION_FAILED` | PDF scanné vide, extraction échouée, embedding échoué | 422 |
| `SERVER_ERROR` | Erreur inattendue côté Next.js | 500 |
| `SERVICE_UNAVAILABLE` | N8N_WEBHOOK_SECRET non configuré | 503 |

## Authentification

### n8n → Next.js
Le workflow utilise un credential n8n de type **HTTP Header Auth** :
- Header name : `X-N8N-Secret`
- Header value : valeur de `N8N_WEBHOOK_SECRET` (jamais en clair dans le JSON)

### Next.js → DB
La route `/api/n8n/ingest` appelle `auth_find_user_by_email()` (fonction
`SECURITY DEFINER` scopée, migration `0010_auth.sql`) pour résoudre
`company_id`/`role`/`department_id` depuis la DB — exactement comme
`authorizeCredentials()` le fait au login. Ensuite `ingestDocument()`
tourne sous `app_role` + RLS via `withAuthContext()`.

## Pourquoi n8n orchestre sans contourner la sécurité

n8n ne connaît pas `company_id` ni `role` — il ne les transmet pas.
Il transmet uniquement l'email de l'utilisateur déclencheur et le fichier.
La route Next.js résout l'identité depuis la DB (app_role, jamais
migration_role), construit l'AuthContext, et passe tout à
`ingestDocument()` qui tourne sous RLS. Le secret partagé prouve que
l'appelant est le n8n de confiance, pas un client arbitraire.

## Import du workflow dans n8n

1. Ouvrir n8n → Menu → Import from file
2. Sélectionner `n8n/workflows/W1-ingestion.json`
3. Créer le credential **HTTP Header Auth** :
   - Name : `ZEN Webhook Secret`
   - Header Name : `X-N8N-Secret`
   - Header Value : valeur de `N8N_WEBHOOK_SECRET` depuis `.env.local`
4. Définir la variable d'environnement n8n `ZEN_APP_URL` :
   - Local : `http://host.docker.internal:3000`
   - Prod : `https://zen-knowledge.vercel.app`
5. Activer le workflow
6. Tester avec le body d'exemple ci-dessus

## Variables / credentials nécessaires

| Nom | Type | Valeur |
|-----|------|--------|
| `ZEN_APP_URL` | Env var n8n | URL de l'app Next.js — déjà définie dans `docker/docker-compose.yml` (service `n8n`), pas besoin de la saisir manuellement |
| `ZEN Webhook Secret` | Credential n8n (HTTP Header Auth) | `N8N_WEBHOOK_SECRET` |
| `N8N_WEBHOOK_SECRET` | Env var Next.js | Secret partagé (min 32 chars) |

## Pièges rencontrés en testant réellement le workflow (n8n 2.38.6)

- **`access to env vars denied`** — n8n bloque par défaut l'accès à
  `$env` depuis les expressions des nœuds (sécurité). Les URL des
  nœuds HTTP Request de W1/W3 utilisent `$env.ZEN_APP_URL`. Fixé via
  `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` dans `docker-compose.yml`
  (déjà en place).
- **Import CLI (`n8n import:workflow`) échoue avec
  `SQLITE_CONSTRAINT: NOT NULL constraint failed: workflow_entity.id`**
  — cette version de n8n exige un champ `"id"` explicite au niveau
  racine du JSON exporté (contrairement à des versions plus anciennes
  qui l'auto-généraient). Les fichiers `W1-ingestion.json` et
  `W3-obsolescence.json` en contiennent déjà un.
