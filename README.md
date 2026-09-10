# ZEN Knowledge

Projet de test technique — **ZEN Group, Série F, F1 : "ZEN Knowledge — RAG interne"**.

## Objectif général

Construire une plateforme conversationnelle interne multi-entreprises permettant de
rechercher des informations dans des documents d'entreprise via un système RAG
(Retrieval-Augmented Generation) sécurisé, avec isolation stricte entre entreprises,
gestion des rôles/permissions, versioning documentaire, citations vérifiables et
outils d'administration.

## Statut

🚧 **Initialisation** — aucune fonctionnalité métier n'est encore implémentée.

Ce dépôt contient pour l'instant uniquement la structure de base du projet
(README, .gitignore, .env.example). Le développement du produit n'a pas commencé.

## Stack envisagée

- Next.js + TypeScript
- PostgreSQL + pgvector
- Auth.js (ou équivalent)
- OpenAI / Groq (embeddings + LLM)
- Stockage S3-compatible
- n8n (automatisation)
- Docker

## Licence / confidentialité

Dépôt privé — projet réalisé dans le cadre d'un test technique de recrutement.
