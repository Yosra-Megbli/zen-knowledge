-- Phase 1: uniquement l'extension nécessaire au démarrage de PostgreSQL.
-- Le schéma métier (Company, User, Document, ...) sera créé en Phase 2.
CREATE EXTENSION IF NOT EXISTS vector;
