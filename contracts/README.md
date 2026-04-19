# Stellar Tickets — Contracts

Workspace Rust/Soroban del proyecto **Stellar Tickets**.

Este directorio contiene la lógica on-chain del sistema, principalmente:
- `event_contract`: contrato principal de boletos, compra, reventa y redención
- `factory_contract`: contrato de registro y gestión de contratos de evento

## Propósito

La capa on-chain se encarga de las reglas que deben quedar verificables en Soroban, como:

- propiedad del boleto
- compra y reventa
- comisionesls
- redención / consumo del boleto
- eventos mínimos para indexación

La lógica de aplicación general, autenticación, catálogo, UI, trazabilidad enriquecida e indexación viven fuera de esta carpeta, en el resto del monorepo.

---

## Estructura

```text
contracts/
├── Cargo.toml
├── Cargo.lock
├── .cargo/
│   └── config.toml
├── .env.example
├── contracts/
│   ├── event_contract/
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   └── test.rs
│   │   └── test_snapshots/
│   └── factory_contract/
│       ├── Cargo.toml
│       ├── src/
│       │   ├── lib.rs
│       │   └── test.rs
│       └── test_snapshots/
└── README.md