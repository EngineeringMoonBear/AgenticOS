-- Honcho v2 requires the pgvector extension on its Postgres database.
-- This file is bind-mounted into the honcho-db container at
-- /docker-entrypoint-initdb.d/init.sql by docker-compose.yml, and runs
-- exactly once when the data directory is first initialized.
CREATE EXTENSION IF NOT EXISTS vector;
