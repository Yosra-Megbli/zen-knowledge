# ZEN Knowledge

Projet de test technique — **ZEN Group, Série F, F1 : "ZEN Knowledge — RAG interne"**.

## Objectif général

Construire une plateforme conversationnelle interne multi-entreprises permettant de
rechercher des informations dans des documents d'entreprise via un système RAG
(Retrieval-Augmented Generation) sécurisé, avec isolation stricte entre entreprises,
gestion des rôles/permissions, versioning documentaire, citations vérifiables et
outils d'administration.

## Statut

🚧 **Phase 1 — Local development foundation** — aucune fonctionnalité métier n'est
encore implémentée (pas de RAG, pas de chat, pas d'authentification, pas
d'ingestion). Cette phase met en place uniquement l'environnement de
développement local.

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

## Licence / confidentialité

Dépôt privé — projet réalisé dans le cadre d'un test technique de recrutement.
