# ZEN Knowledge

Projet de test technique — **ZEN Group, Série F, F1 : "ZEN Knowledge — RAG interne"**.

Plateforme conversationnelle interne multi-entreprises permettant de
rechercher des informations dans des documents d'entreprise via un
système RAG (Retrieval-Augmented Generation) sécurisé : isolation
stricte entre entreprises, permissions par rôle/département/
visibilité, versioning documentaire, citations vérifiables,
obsolescence automatique, et outils d'administration — le tout à
**budget 0€**.

## 🔑 Tester en 2 minutes

**URL** : https://zen-knowledge.vercel.app/login — la page propose des
boutons de connexion rapide pour les comptes ci-dessous (un clic,
aucun mot de passe à copier).

| Entreprise | Rôle | Email | Mot de passe |
|---|---|---|---|
| ZEN Retail Tunisia | Admin | `admin@zenretail.example` | `ZenDemo2026!` |
| ZEN Retail Tunisia | Employé | `employee@zenretail.example` | `ZenDemo2026!` |
| ZEN Home & Lifestyle | Admin | `admin@zenhomelifestyle.example` | `ZenDemo2026!` |

### Preuve d'isolation — le test croisé

Le "Rapport financier confidentiel — T4 2025" existe réellement en
base, publié chez **ZEN Home & Lifestyle** uniquement.

1. Connectez-vous en **ZEN Retail Tunisia** (admin) → demandez *"Quel
   est le chiffre d'affaires du dernier trimestre ?"* → **refus**,
   alors que l'information existe en base — chez l'autre entreprise.
2. Reconnectez-vous en **ZEN Home & Lifestyle** (admin) → posez
   exactement la même question → réponse sourcée, citation cliquable.
3. Connectez-vous en **ZEN Retail Tunisia — Employé** → demandez la
   grille salariale 2026 (document `restricted`, propre à sa société) →
   **refus** — prouve que le filtrage descend jusqu'au rôle, pas
   seulement à l'entreprise.

Dans les trois cas de refus, le message est strictement identique
(`"I don't have enough authorized sources to answer this question."`)
— qu'il s'agisse d'une question hors sujet, d'un document d'une autre
entreprise ou d'un document restreint. Le refus ne révèle jamais
*pourquoi*, donc jamais si le document existe ailleurs.

## Statut

Fonctionnalité complète de bout en bout :

- Authentification (Auth.js), sessions JWT, contexte d'autorisation serveur-only
- Base PostgreSQL + pgvector, RLS sur les 12 tables, deux rôles PostgreSQL séparés
- Embeddings locaux (aucun appel API externe), recherche vectorielle autorisée par RLS
- Pipeline d'ingestion complet (upload → extraction → nettoyage → chunking → embedding → publication explicite)
- Génération de réponse RAG via Groq, citations vérifiables, refus "aucune source" avant tout appel LLM
- UI : login, chat, gestion documentaire, administration
- Workflows n8n : **W1** (ingestion) et **W3** (obsolescence — scan, notification, dépublication automatique)
- Déploiement Vercel + Supabase Free fonctionnel
- Dataset de démonstration réaliste (14 documents, 2 entreprises) — voir [`dataset/README.md`](dataset/README.md)

Non couvert par ce dépôt : workflow n8n **W2** (implémenté directement
comme routes Next.js `/api/rag/*` plutôt qu'en n8n séparé — voir
"Pourquoi W2 n'est pas un workflow n8n" plus bas), vidéo de
démonstration.

## Stack (0€)

| Composant | Choix | Pourquoi |
|---|---|---|
| Framework | Next.js 16 (App Router) + TypeScript | |
| Base de données | PostgreSQL + pgvector — Docker en local, **Supabase Free** en production | Pas d'AWS/RDS payant |
| LLM | **Groq** (`openai/gpt-oss-120b`) | Alternative gratuite à OpenAI, API compatible |
| Embeddings | **Locaux** — `Xenova/multilingual-e5-small` (384D, CPU) via `@huggingface/transformers` | Pas d'API d'embedding payante |
| Stockage fichiers | Provider abstrait — filesystem local en dev, **Supabase Storage** en production | Pas d'AWS S3 |
| Auth | Auth.js (Credentials + JWT) | |
| Automatisation | n8n auto-hébergé (Docker) | |

## Architecture — permissions avant recherche vectorielle

Le principe non négociable de ce projet : **l'autorisation ne filtre
jamais après coup un résultat de recherche vectorielle — elle fait
partie de la requête SQL elle-même**, via PostgreSQL Row-Level
Security.

```
Auth.js session (JWT signé, jamais modifiable côté client)
    ↓
lib/permissions/authContext.ts : getAuthContext()
    ↓
{ userId, companyId, role, departmentId }
    ↓
lib/db/withAuthContext.ts  — BEGIN; SET LOCAL app.company_id/role/department_id; ... ; COMMIT
    ↓
PostgreSQL RLS (db/migrations/0009_rls_and_grants.sql)
    ↓
SELECT ... FROM document_chunks ORDER BY embedding <=> $1 LIMIT $2
    (la policy RLS s'applique AVANT le tri par similarité — jamais un post-filtre TypeScript)
```

Deux rôles PostgreSQL distincts (`db/migrations/0002_roles.sql`) :

- **`migration_role`** — superutilisateur Docker local. Migrations,
  seed, maintenance. **Jamais utilisé au runtime applicatif.**
- **`app_role`** — `NOSUPERUSER`, `NOBYPASSRLS`. Utilisé pour **toutes**
  les requêtes runtime (auth, ingestion, retrieval, RAG, W1/W3). Ne
  peut jamais contourner une policy RLS, même par erreur de code.

Exception étroite et auditée : quelques fonctions PostgreSQL
`SECURITY DEFINER` (`auth_find_user_by_email`, `w3_get_review_due_documents`,
`w3_resolve_document_for_task`, les deux triggers `propagate_*_auth_change`)
pour les cas où une opération légitime doit s'exécuter *avant* qu'un
contexte RLS puisse exister (résolution d'identité au login, scan
administratif cross-company). Chacune : ne retourne que les colonnes
strictement nécessaires, `EXECUTE` révoqué de `PUBLIC` et accordé
uniquement à `app_role`, `search_path` figé.

## Développement local

### Prérequis

- Node.js >= 24
- Docker + Docker Compose

### Installation

```
npm install
cp .env.example .env.local
```

Renseigner `.env.local` (jamais commit). Voir les commentaires dans
`.env.example` pour chaque variable, en particulier `RAG_MIN_SIMILARITY`
(calibrage expliqué dans le fichier) et la distinction `DATABASE_URL`
(`app_role`, jamais `postgres`) vs `SUPABASE_DIRECT_URL` (`postgres`,
migrations uniquement).

### Services (PostgreSQL + pgvector, n8n)

```
docker compose -f docker/docker-compose.yml up -d
```

### Application

```
npm run db:migrate
npm run dev
```

- App : http://localhost:3000
- Health check : http://localhost:3000/api/health
- n8n : http://localhost:5678

## Base de données

12 tables : `companies`, `departments`, `users`, `documents`,
`document_versions`, `document_chunks`, `ingestion_jobs`, `conversations`,
`conversation_messages`, `citations`, `feedback`, `audit_logs`, plus
`review_tasks` (W3). Schéma complet : [`db/migrations/`](db/migrations/).

RLS activée et **forcée** (`FORCE ROW LEVEL SECURITY`) sur toutes les
tables. `document_chunks_select` (la policy la plus importante) filtre
en une seule clause : entreprise, statut publication du document ET de
la version, et visibilité (`company` / `department` / `restricted`).

### Commandes DB

```
npm run db:migrate        # migrations idempotentes
npm run db:reset          # DROP/CREATE SCHEMA public puis re-migrer (ne touche pas aux rôles)
npm run db:seed           # fixtures RLS/RAG (Acme Corp / Nova Bank) — hand-inserted, pour les tests automatisés
npm run db:seed-demo      # dataset de démo réaliste (ZEN Retail Tunisia / ZEN Home & Lifestyle) — via le vrai pipeline, pour la démo/grading
```

`db:seed` et `db:seed-demo` créent des entreprises totalement
distinctes — ils ne se marchent jamais dessus et peuvent tous les deux
tourner sur la même base.

## Pipeline d'ingestion — "Upload ≠ Published"

`lib/ingestion/pipeline/ingestDocument.ts` est le point d'entrée
unique, utilisé identiquement par l'upload UI (`/api/documents/upload`)
et par le webhook n8n W1 (`/api/n8n/ingest`) :

```
validation fichier (type/taille) → extraction texte (PDF/TXT)
  → nettoyage → découpage en chunks → embedding local
  → persistance (document_version.status = 'ready')
```

Un document ingéré **ne devient jamais publié automatiquement** — la
publication (`publishVersion.ts`) est une action explicite séparée,
qui exige `role != 'employee'`. Tant qu'un document n'est pas publié,
`document_chunks_select` (RLS) le rend structurellement invisible au
retrieval, quel que soit le rôle de l'utilisateur qui interroge —
prouvé par test, pas seulement par convention de code.

Gestion d'erreurs typée (`lib/ingestion/errors.ts`) : fichier vide,
type non supporté, PDF corrompu/scanné sans texte, échec
d'embedding — chaque échec est journalisé dans `ingestion_jobs` avec
un code d'erreur, jamais avec le contenu du document.

## RAG — génération de réponse

`lib/rag/answerQuestion.ts` orchestre :

1. `retrieveAuthorizedChunks()` (RLS, voir plus haut)
2. **Seuil no-source** (`RAG_MIN_SIMILARITY`) : si aucun chunk autorisé
   ne dépasse le seuil, retour `{ noSource: true }` — **le LLM n'est
   jamais appelé**. Vérifié par test (`F — zero authorized sources
   produces refusal without calling LLM`), pas seulement par une
   instruction de prompt.
3. Appel Groq (`lib/llm/groq.ts`) avec uniquement les chunks autorisés
   comme contexte — jamais de contenu d'une autre entreprise, jamais
   de chunk non publié/supprimé/archivé (chacun prouvé par test).
4. Citations reconstruites à partir des `[SOURCE n]` réellement
   présentes dans le contexte envoyé — une citation fabriquée par le
   LLM vers une source inexistante est silencieusement écartée, jamais
   affichée.
5. Journalisation dans `audit_logs` (métadonnées uniquement — jamais
   `GROQ_API_KEY`, jamais le contenu brut du document).

Le texte d'un document (y compris une tentative d'injection de prompt
qu'il contiendrait) est **toujours passé au LLM comme donnée dans un
bloc source**, jamais interprété comme une instruction — voir le
document `A7` du dataset de démo et le test `O`.

## n8n — automatisation

### W1 — Ingestion

Webhook `POST /api/n8n/ingest` (secret partagé `X-N8N-Secret`).
`company_id`/`role`/`department_id` résolus côté serveur via
`auth_find_user_by_email()` (jamais acceptés du corps de la requête).
Workflow + doc : [`n8n/workflows/W1-ingestion.json`](n8n/workflows/W1-ingestion.json),
[`n8n/docs/W1-ingestion.md`](n8n/docs/W1-ingestion.md).

### W3 — Obsolescence

Cron quotidien : scanne les documents publiés dont `review_date`
approche ou est dépassée (`GET /api/n8n/review-due`, cross-company via
`w3_get_review_due_documents()` — SECURITY DEFINER), notifie
(`POST /api/n8n/review-due/notify`, upsert idempotent sur
`review_tasks`), et dépublie automatiquement au-delà de la période de
grâce (`POST /api/n8n/unpublish`) — le document redevient
immédiatement non-retrouvable, exactement comme une dépublication
manuelle. Workflow + doc : [`n8n/workflows/W3-obsolescence.json`](n8n/workflows/W3-obsolescence.json),
[`n8n/docs/W3-obsolescence.md`](n8n/docs/W3-obsolescence.md).

Toutes les routes d'écriture W3 résolvent `company_id`/`owner_id`
côté serveur via `w3_resolve_document_for_task()` — jamais depuis le
corps de la requête n8n, même si n8n est un appelant de confiance
(principe appliqué uniformément, pas seulement pour les entrées
utilisateur).

### Pourquoi W2 n'est pas un workflow n8n séparé

La spec envisage W2 comme "workflow question/RAG". Il est implémenté
directement comme routes Next.js (`/api/rag/answer`, `/api/rag/retrieve`,
`/api/rag/feedback`), appelées par l'UI chat, plutôt que via un
webhook n8n intermédiaire : la latence d'un aller-retour HTTP
supplémentaire (Next.js → n8n → Next.js → Groq) n'apporte aucun
bénéfice d'orchestration ici (contrairement à W1/W3, qui sont
déclenchés par des événements externes — upload utilisateur asynchrone,
cron) et dégraderait l'expérience de chat interactif.

## Interface

- `/login` — Auth.js Credentials
- `/chat` — question/réponse RAG, citations cliquables vers le fichier source
- `/documents` — liste, upload, publication explicite (bouton "Publier", visible uniquement quand une version est `ready`)
- `/admin` — statistiques d'usage (`/api/admin/stats`)

## Tests

```
npm run test:rls          # 13 — isolation RLS, connexion directe app_role
npm run test:embeddings   # 6  — embeddings locaux
npm run test:auth         # 11 — callbacks Auth.js
npm run test:rag          # 34 — retrieval + génération RAG (sécurité + comportement)
npm run test:ingestion    # 45 — pipeline d'ingestion + suppression de document + W3 (inclut unpublishDocument, resolve function, upsert review_tasks)
npm run test:auth-http    # 5  — HTTP live (nécessite un serveur démarré)
npm run test:conversations-http  # 4  — HTTP live, isolation par utilisateur (même société) sur /api/conversations
npm run test:phase3       # rls + embeddings + auth + rag
npm run test:phase5       # rls + ingestion + rag5
```

### CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) : sur chaque push/PR,
service Postgres éphémère (`pgvector/pgvector:0.8.6-pg16`, même image que
`docker/docker-compose.yml`) → install → lint → build → migrations →
`db:seed` (fixtures RLS, pas le dataset de démo) → `test:phase3` +
`test:phase5` → build+`start`+`test:auth-http`+`test:conversations-http`
contre un vrai serveur. Aucun test CI n'appelle un vrai `GROQ_API_KEY`
(cohérent avec "Limitations connues" ci-dessous) — `test:conversations-http`
seed ses conversations directement via `ensureConversation`/`persistTurn`
plutôt que par un vrai appel LLM. `APP_ROLE_PASSWORD`/`AUTH_SECRET` sont des
valeurs jetables propres au job (rien de réel à protéger) ; `GROQ_API_KEY`
est câblé sur `secrets.GROQ_API_KEY` si jamais un test réel s'y ajoute.

Discipline : toutes les propriétés de sécurité listées ci-dessus sont
vérifiées par un test qui échouerait si la propriété était violée —
jamais uniquement par lecture de code ou convention. Plusieurs bugs
réels ont été trouvés par cette discipline en cours de projet (policy
RLS combinant SELECT+UPDATE en AND, seuil `RAG_MIN_SIMILARITY` jamais
calibré, écart entre `document_chunks` RLS company-only et la
visibilité réelle sur la route de téléchargement de fichier — voir
git log pour le détail de chaque correction).

## Dataset de démonstration

14 documents réalistes (français), 2 entreprises fictives, ingérés et
publiés via le vrai pipeline. Couvre toutes les visibilités,
versioning, obsolescence, une contradiction volontaire entre deux
documents publiés, une tentative d'injection de prompt, un document
jamais publié et un document supprimé. Détail complet, comptes de
démonstration et scénarios de test suggérés : [`dataset/README.md`](dataset/README.md).

```
npm run db:seed-demo
```

## Déploiement (Vercel + Supabase Free)

- Base : Supabase Free (Postgres + pgvector), connexion runtime via le
  pooler Supavisor **avec `app_role`**, jamais `postgres` (voir
  `.env.example`).
- Stockage : `lib/storage/index.ts` sélectionne automatiquement
  Supabase Storage si `SUPABASE_URL` est défini, sinon le filesystem
  local (incompatible avec le filesystem éphémère de Vercel).
- Auth.js : `trustHost: true` explicitement dans la config
  `NextAuth({...})` (pas seulement `AUTH_TRUST_HOST` en variable
  d'environnement — source d'un bug de production `UntrustedHost`
  résolu en cours de projet).
- Variables d'environnement à configurer sur Vercel : toutes celles de
  `.env.example`, avec `RAG_MIN_SIMILARITY=0.83` (voir calibrage
  ci-dessus) et le mot de passe `app_role` réel (distinct du mot de
  passe superutilisateur `postgres`, à faire tourner régulièrement).

## Limitations connues

- **`RAG_MIN_SIMILARITY` doit être configuré manuellement sur Vercel**
  (`0.83`, voir `.env.example`) — le fallback code (`0.3`) est
  délibérément conservateur mais insuffisant en pratique pour ce
  modèle d'embedding.
- Pas de vidéo de démonstration (hors du périmètre d'un assistant
  automatisé).
- Pas de test automatisé de bout en bout contre un vrai
  `GROQ_API_KEY` en environnement CI (les tests RAG utilisent un
  fournisseur LLM mocké, injecté via `setLlmProvider()` — le contrat
  d'appel HTTP/parsing de réponse Groq lui-même n'est vérifié que
  manuellement).
- Le mot de passe superutilisateur Supabase (`SUPABASE_DIRECT_URL`)
  doit être tourné périodiquement dans le tableau de bord Supabase —
  action manuelle, hors du périmètre du code.

## Licence / confidentialité

Dépôt privé — projet réalisé dans le cadre d'un test technique de recrutement.
