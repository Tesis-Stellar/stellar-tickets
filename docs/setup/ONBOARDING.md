# Onboarding del entorno (Mac + Devcontainer)

## 1. Pre-requisitos globales (host)

- Docker Desktop
- Cursor o VS Code
- Git

No instales globalmente Rust, Stellar CLI ni targets wasm para este proyecto.

## 2. Abrir proyecto en contenedor

1. Abre la carpeta `stellar-tickets` en Cursor/VS Code.
2. Ejecuta: "Dev Containers: Reopen in Container".
3. Espera a que termine `postCreate.sh`.

## 3. Verificar toolchain del proyecto

Ejecuta en terminal del contenedor:

```bash
bash tooling/bootstrap-check.sh
```

## 4. Versiones fijadas

- Rust: definido en `rust-toolchain.toml`.
- Targets: `wasm32-unknown-unknown` y `wasm32v1-none`.
- Stellar CLI: definido en `.devcontainer/postCreate.sh`.

## 5. Regla de oro

Toda compilacion y pruebas de contratos se hacen dentro del contenedor.
No usar toolchains del host para este repo.
