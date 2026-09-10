# ZEN Knowledge

Projet de test technique — **ZEN Group, Série F, F1 : "ZEN Knowledge — RAG interne"**.

## Objectif général

Construire une plateforme conversationnelle interne multi-entreprises permettant de
rechercher des informations dans des documents d'entreprise via un système RAG
(Retrieval-Augmented Generation) sécurisé, avec isolation stricte entre entreprises,
gestion des rôles/permissions, versioning documentaire, citations vérifiables et
outils d'administration.

## Statut

🚧 **Phase 2 — Database schema + PostgreSQL RLS** — le schéma métier et
l'isolation multi-entreprise au niveau base de données sont en place et
testés. Aucune fonctionnalité applicative n'est encore implémentée : pas
d'authentification (Auth.js), pas d'embeddings, pas de LLM/Groq, pas de
RAG, pas de chat, pas de workflows n8n, pas d'UI métier.

## Stack

- Next.js + TypeScript
- PostgreSQL + pgvector (Docker en local, Supabase Free en démonstration)
- Auth.js (Phase 2+)
- Groq (LLM) — modèle `openai/gpt-oss-120b`
- Embeddings locaux — `Xenova/multilingual-e5-small` via `@huggingface/transformers` (384 dimensions, CPU, gratuit)
- Stockage Supabase Storage (abstraction remplaçable)
- n8n (auto-hébergé, Docker)

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

Le contexte (`company_id`, `role`, `department_id`) sera fourni par
Auth.js en Phase 3+. Pour l'instant, `db/db.mjs` expose
`withAuthContext()`, qui l'applique de façon strictement
transactionnelle :

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
npm run db:migrate   # applique les migrations non encore appliquées (idempotent)
npm run db:reset      # DROP/CREATE SCHEMA public (ne touche pas aux rôles) puis re-migrer
npm run db:seed       # données fictives multi-entreprises (voir db/seed.mjs)
npm run test:rls       # 13 tests d'isolation, exécutés directement via app_role
```

### Tests de sécurité

`tests/integration/rls/` — connectent directement en PostgreSQL avec
`app_role` (jamais via une fonction TypeScript de filtrage) : isolation
cross-company, isolation par rôle/département, documents non publiés/
supprimés/obsolètes, anciennes versions, cycle de vie transactionnel du
contexte, et une preuve explicite que `app_role` voit strictement moins
de lignes que `migration_role` sur la même requête sans clause `WHERE`.

## Licence / confidentialité

Dépôt privé — projet réalisé dans le cadre d'un test technique de recrutement.
