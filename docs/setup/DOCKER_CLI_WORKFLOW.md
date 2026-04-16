# Flujo recomendado: Docker CLI (sin Devcontainer)

Este flujo evita depender de Rust o Stellar CLI instalados en el host y reduce carga del IDE.

## 1) Construir imagen de toolchain

```bash
bash tooling/contracts-docker.sh build-image
```

## 2) Verificar versiones fijadas

```bash
bash tooling/contracts-docker.sh check-toolchain
```

Debe mostrar:
- Rust `1.86.0`
- Stellar CLI `23.0.0`
- target `wasm32v1-none` instalado

## 2.1) Health check en una sola orden

```bash
bash tooling/health-check.sh
```

Este comando valida daemon Docker, imagen, toolchain, build y tests.

## 3) Compilar contratos

```bash
bash tooling/contracts-docker.sh build
```

Nota: actualmente `event_contract` compila de forma estable y `factory_contract` puede fallar por colision de simbolos en el workspace. El script lo reporta como warning para mantener el flujo alineado con CI.

## 4) Ejecutar tests

```bash
bash tooling/contracts-docker.sh test
```

## 5) Entrar a shell del contenedor (opcional)

```bash
bash tooling/contracts-docker.sh shell
```

## Versionado del SDK

- El SDK se fija en `contracts/Cargo.toml` con `soroban-sdk = "=23.0.0"`.
- No usar `latest` ni rango abierto para SDK en tesis.

## Actualizaciones seguras

1. Crear rama dedicada `chore/soroban-upgrade-fecha`.
2. Cambiar solo una capa por vez (SDK o CLI o Rust).
3. Ejecutar build + tests con este flujo Docker CLI.
4. Merge solo si CI pasa.
