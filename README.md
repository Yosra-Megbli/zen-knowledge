# ZEN Knowledge

Projet de test technique — **ZEN Group, Série F, F1 : "ZEN Knowledge — RAG interne"**.

## Objectif général

Construire une plateforme conversationnelle interne multi-entreprises permettant de
rechercher des informations dans des documents d'entreprise via un système RAG
(Retrieval-Augmented Generation) sécurisé, avec isolation stricte entre entreprises,
gestion des rôles/permissions, versioning documentaire, citations vérifiables et
outils d'administration.

## Statut

🚧 **Phase 3 — Authentication + local embeddings + authorized vector
retrieval** — un utilisateur peut se connecter (Auth.js), et une requête
de recherche authentifiée exécute une vraie recherche vectorielle
(pgvector, embeddings locaux 384D) filtrée par PostgreSQL RLS. Pas de
génération de réponse LLM/Groq, pas de RAG complet, pas de chat, pas de
workflows n8n, pas d'ingestion de documents, pas d'UI métier, pas de
déploiement.

## Stack

- Next.js + TypeScript
- PostgreSQL + pgvector (Docker en local, Supabase Free en démonstration)
- Auth.js (Credentials + JWT) — implémenté Phase 3
- Embeddings locaux — `Xenova/multilingual-e5-small` via `@huggingface/transformers` (384 dimensions, CPU, gratuit) — implémenté Phase 3
- Groq (LLM) — modèle `openai/gpt-oss-120b` — pas encore implémenté (Phase 4+)
- Stockage Supabase Storage (abstraction remplaçable) — pas encore implémenté
- n8n (auto-hébergé, Docker) — pas encore implémenté

## Développement local (Phase 1)

### Prérequis

- Node.js >= 24
- Docker + Docker Compose

### Installation

```
npm install
cp .env.example .env.local
```

Renseigner les valeurs dans `.env.local` (jamais commit — voir `.gitignore`).

### Lancer les services (PostgreSQL + pgvector, n8n)

```
docker compose -f docker/docker-compose.yml up -d
```

### Lancer l'application Next.js

```
npm run dev
```

### Vérifications

- Application : http://localhost:3000
- Health check : http://localhost:3000/api/health
- n8n : http://localhost:5678
- PostgreSQL : `docker compose -f docker/docker-compose.yml exec postgres pg_isready`

## Base de données (Phase 2)

### Schéma

12 tables : `companies`, `departments`, `users`, `documents`,
`document_versions`, `document_chunks`, `ingestion_jobs`, `conversations`,
`conversation_messages`, `citations`, `feedback`, `audit_logs`.
Définition complète : [`db/migrations/`](db/migrations/).

### Rôles PostgreSQL

- **migration_role** (`POSTGRES_USER`, superutilisateur Docker local) —
  migrations, création des policies, seed, maintenance contrôlée.
  **Jamais utilisé au runtime.** Contourne RLS par nature (propriété des
  superutilisateurs PostgreSQL, pas une faille de ce schéma).
- **app_role** — rôle applicatif restreint (`NOSUPERUSER`, `NOBYPASSRLS`),
  créé par `db/migrations/0002_roles.sql`. Utilisé pour **toutes** les
  requêtes runtime, une fois qu'il y en aura (Phase 3+). Ne peut jamais
  contourner les policies RLS.

### Row Level Security

RLS activée et forcée sur les 12 tables. `document_chunks` porte le
filtre complet (company + statut publication du document et de la
version + visibilité company/department/restricted) directement sur la
table qui servira au futur retrieval vectoriel — l'autorisation fait
partie de la requête, jamais un post-filtre. Détail des policies :
[`db/migrations/0009_rls_and_grants.sql`](db/migrations/0009_rls_and_grants.sql).

### Contexte d'autorisation

`db/db.mjs` (scripts) expose `withAuthContext()` pour les tests/seed ;
`lib/db/withAuthContext.ts` (application) fait de même pour le runtime,
sur un pool `app_role`. Les deux appliquent le contexte de façon
strictement transactionnelle :

```
BEGIN
SELECT set_config('app.company_id', '...', true)
SELECT set_config('app.role', '...', true)
SELECT set_config('app.department_id', '...', true)
-- requête
COMMIT
```

Le `true` (LOCAL) garantit que le contexte disparaît automatiquement au
`COMMIT`/`ROLLBACK` — jamais de variable globale applicative.

### Commandes

```
npm run db:migrate      # applique les migrations non encore appliquées (idempotent)
npm run db:reset         # DROP/CREATE SCHEMA public (ne touche pas aux rôles) puis re-migrer
npm run db:seed           # données fictives multi-entreprises + embeddings réels (voir db/seed.mjs)
npm run test:rls            # 13 tests d'isolation Phase 2, exécutés directement via app_role
npm run test:embeddings      # 6 tests unitaires embeddings (voir "Embeddings locaux" ci-dessous)
npm run test:auth             # 11 tests unitaires Auth.js (callbacks, sans serveur HTTP)
npm run test:rag                # 15 tests de sécurité retrieval (TEST A-L + seuil no-source)
npm run test:auth-http            # 5 tests HTTP live — nécessite un serveur démarré (voir plus bas)
npm run test:phase3                # rls + embeddings + auth + rag, dans cet ordre
```

### Tests de sécurité

`tests/integration/rls/` — connectent directement en PostgreSQL avec
`app_role` (jamais via une fonction TypeScript de filtrage) : isolation
cross-company, isolation par rôle/département, documents non publiés/
supprimés/obsolètes, anciennes versions, cycle de vie transactionnel du
contexte, et une preuve explicite que `app_role` voit strictement moins
de lignes que `migration_role` sur la même requête sans clause `WHERE`.

## Authentication + embeddings + retrieval autorisé (Phase 3)

### Architecture d'authentification

Auth.js (Credentials provider, sessions JWT) **identifie** l'utilisateur
— ce n'est pas un second système d'autorisation. Le flux complet :

```
Auth.js session (JWT signé)
    ↓
lib/permissions/authContext.ts : getAuthContext()
    ↓
{ userId, companyId, role, departmentId }  (jamais depuis le client)
    ↓
lib/db/withAuthContext.ts
    ↓
Transaction PostgreSQL (app_role) + SET LOCAL
    ↓
PostgreSQL RLS (db/migrations/0009_rls_and_grants.sql)
```

Un utilisateur authentifié sans `company_id` (`getAuthContext()`
retourne `null`) est refusé — jamais de company assignée
silencieusement.

**Login** : `POST /api/auth/callback/credentials` (email + password).
La correspondance email → utilisateur passe par
`auth_find_user_by_email()`, une fonction `SECURITY DEFINER` étroitement
scopée (`db/migrations/0010_auth.sql`) — la seule exception nécessaire
pour retrouver l'entreprise d'un utilisateur **avant** qu'un contexte
RLS puisse exister. Elle ne retourne que les colonnes d'identité,
`EXECUTE` est révoqué de `PUBLIC` et accordé uniquement à `app_role`.

**Le client ne peut jamais imposer `company_id`/`role`/`department_id`** :
`authorizeCredentials()` (`lib/auth/callbacks.ts`) ne lit que
`email`/`password` du payload de connexion ; ces trois valeurs viennent
exclusivement du JWT signé côté serveur. Prouvé par test (voir plus
bas), y compris avec un payload contenant des champs falsifiés.

### Demo credentials (données fictives, seed uniquement)

```
admin@acmecorp.example        / ZenDemo2026!
contributor@acmecorp.example  / ZenDemo2026!
employee@acmecorp.example     / ZenDemo2026!
admin@novabank.example        / ZenDemo2026!
...
```

Mot de passe identique pour tous les comptes de démonstration créés par
`npm run db:seed` — aucune donnée réelle, base Docker locale uniquement.

### Embeddings locaux

- Modèle : `Xenova/multilingual-e5-small` via `@huggingface/transformers`
- Dimension : **384**, exécution CPU, aucune clé API, aucun appel externe
- Préfixes obligatoires : `"query: "` (recherche) / `"passage: "` (documents) —
  voir `lib/embeddings/prefixes.ts`
- Pooling `mean` + normalisation L2 (requis par le modèle)
- Instance singleton (`lib/embeddings/local-e5.ts`), chargée une seule fois
- Cache local du modèle (~100 Mo) : `.cache/transformers-models/`
  (gitignored) — téléchargé une fois, réutilisé ensuite
- **Premier test/premier appel = lent** (téléchargement + chargement du
  modèle, quelques secondes à ~1 minute selon la connexion). Les appels
  suivants dans le même process sont rapides (mémoïsation).

### Retrieval vectoriel autorisé

`lib/rag/retrieveAuthorizedChunks.ts` est le **seul** point d'accès à
`document_chunks`. Il utilise exclusivement `app_role` (jamais
`migration_role`), génère l'embedding de la requête localement, et
laisse PostgreSQL RLS filtrer :

```sql
-- à l'intérieur de withAuthContext (app_role, contexte déjà posé)
SELECT ...
FROM document_chunks dc
JOIN documents d ON d.id = dc.document_id
JOIN document_versions v ON v.id = dc.document_version_id
WHERE dc.embedding IS NOT NULL
ORDER BY dc.embedding <=> $1::vector
LIMIT $2
```

Aucun `WHERE company_id = ...` explicite n'est nécessaire dans cette
requête : la policy RLS `document_chunks_select` s'applique
automatiquement, avant le tri vectoriel. Une assertion applicative
post-requête (défense en profondeur) vérifie que chaque ligne retournée
appartient bien au `company_id` du contexte, et lève une erreur sinon —
jamais un simple filtre silencieux.

### Seuil no-source (fondation, pas de génération de réponse)

`RAG_MIN_SIMILARITY` (défaut conservateur : `0.3`, non calibré) définit
la similarité minimale pour qu'un chunk autorisé soit considéré
pertinent. En dessous, `retrieveAuthorizedChunks()` retourne
`noSource: true` et une liste vide. **Aucune réponse n'est générée** —
ce mécanisme prépare uniquement la Phase 4 (Groq/RAG).

### Limitations connues

- Pas de génération de réponse LLM (Groq) — hors périmètre Phase 3
- Pas de protection anti prompt-injection dans les documents — appartient
  à la phase d'ingestion/RAG, volontairement pas revendiquée ici
- Seuil `RAG_MIN_SIMILARITY` non calibré sur un vrai corpus
- Pas d'UI de connexion — uniquement l'API Auth.js et un test HTTP direct
- `npm run test:auth-http` nécessite un serveur démarré au préalable
  (`npm run build && PORT=3100 npm run start`), comme `test:rls` nécessite
  Docker démarré — ce n'est pas un test auto-suffisant

## Licence / confidentialité

Dépôt privé — projet réalisé dans le cadre d'un test technique de recrutement.
