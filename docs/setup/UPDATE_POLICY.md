# Politica de actualizacion de toolchain

## Objetivo
Evitar que actualizaciones rompan el proyecto durante la tesis.

## Regla
No usar `latest` en Rust ni Stellar CLI.

## Procedimiento de actualizacion

1. Crear rama dedicada, por ejemplo: `chore/toolchain-upgrade-YYYY-MM-DD`.
2. Cambiar una sola cosa por PR (Rust o CLI, no ambos a la vez).
3. Rebuild en devcontainer.
4. Ejecutar:
   - `bash tooling/bootstrap-check.sh`
   - pruebas del backend/frontend relacionadas
5. Si falla, revertir la rama de upgrade.
6. Si pasa, documentar el cambio en este archivo con fecha.

## Matriz minima antes de merge

- Build de contratos Soroban exitoso
- Tests de contratos exitosos
- Backend compila
- Frontend compila
- CI verde
