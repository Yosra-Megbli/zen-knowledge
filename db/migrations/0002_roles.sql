-- app_role: the ONLY role used at runtime by the application (reads and
-- writes, once Auth.js/ingestion/RAG exist in later phases).
--
-- NOBYPASSRLS is the critical property here: this role can never bypass
-- Row Level Security. The role that runs these migrations (the Postgres
-- superuser provided by POSTGRES_USER in docker-compose, or the Supabase
-- "postgres" role in production) is NOT used at runtime — it is reserved
-- for migrations, policy creation and controlled maintenance, and it
-- DOES bypass RLS because it is a superuser. This file creates the
-- restricted role explicitly so the distinction is never accidental.
--
-- __APP_ROLE_PASSWORD__ is substituted by db/migrate.mjs from the
-- APP_ROLE_PASSWORD environment variable at migration time. It is never
-- hardcoded in this file and never committed anywhere else.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role LOGIN PASSWORD '__APP_ROLE_PASSWORD__'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  ELSE
    ALTER ROLE app_role WITH PASSWORD '__APP_ROLE_PASSWORD__';
  END IF;
END
$$;
