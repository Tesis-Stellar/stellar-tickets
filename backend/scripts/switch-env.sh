#!/bin/bash
# Uso: ./scripts/switch-env.sh [test|prod]
# Copia el .env del ambiente indicado al .env activo

ENV=${1:-test}

if [ "$ENV" = "test" ]; then
  cp .env.test .env
  echo "Ambiente: TEST (Supabase eqqamjebaykzeegzhxww)"
elif [ "$ENV" = "prod" ]; then
  cp .env.prod .env
  echo "Ambiente: PROD (Supabase kyvvuhkjphamlimmepgp)"
else
  echo "Uso: ./scripts/switch-env.sh [test|prod]"
  exit 1
fi
