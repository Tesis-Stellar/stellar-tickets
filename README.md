1
# Stellar Tickets — Arquitectura Híbrida Web2.5

Este repositorio contiene la implementación técnica para la tesis **Stellar Tickets**.
El objetivo del proyecto es solucionar los problemas de fraude y especulación en el mercado secundario de boletería mediante la integración de la blockchain de **Stellar (Soroban)** en un entorno de tiquetera tradicional (Web2).

## El Concepto: Web2.5

En lugar de construir una aplicación 100% descentralizada (DApp), este proyecto utiliza un enfoque híbrido:
1. **Web2 (El Catálogo y Auth)**: Una aplicación web tradicional donde los usuarios se registran con correo/contraseña y exploran los eventos. Es rápido, familiar y sin fricción inicial.
2. **Web3 (El Checkout y Propiedad)**: Al momento de pagar, el usuario conecta su Freighter Wallet. El boleto se mintea en la blockchain como un activo digital incensurable.
3. **El Mercado Secundario Seguro (P2P)**: Si un usuario no puede asistir, puede listar su boleto en la blockchain. Cuando otro usuario lo compra, el contrato inteligente ejecuta un *burn/remint* atómico (destruye el boleto original y crea uno idéntico para el comprador) y transfiere los fondos (USDC) automáticamente, deduciendo las comisiones pre-programadas para el organizador.

---

## Estructura del Monorepo

El código está dividido en tres pilares arquitectónicos:

```text
stellar-tickets/
  ├── contracts/                 # CAPA WEB3
  │    ├── event_contract/       # Lógica atómica de cada evento (Burn/Remint, Pagos)
  │    └── factory_contract/     # Registra y despliega nuevos contratos de eventos
  │
  ├── backend/                   # ENLACE WEB2.5 (Express + Prisma)
  │    ├── src/api/              # Proxy: Construye transacciones XDR sin tocar llaves privadas
  │    ├── src/indexer/          # Sincronizador: Lee la blockchain y actualiza el catálogo Web2
  │    └── prisma/               # Esquema de la base de datos PostgreSQL
  │
  └── frontend/                  # CAPA WEB2
       ├── public/
       └── src/                  # Interfaz de Usuario (React) y conexión a Freighter
```

---

## Flujo de Trabajo (User Journey)

### 1. Exploración (Puro Web2)
El usuario ingresa a la plataforma, inicia sesión con su contraseña y navega el catálogo de eventos expuesto por el backend (`GET /api/events`), el cual lee de PostgreSQL para una carga instantánea.

### 2. Venta Primaria (Web2.5)
El usuario selecciona un evento y presiona **"Comprar con USDC"**.
El backend (`POST /api/transactions/buy`) genera la transacción XDR en bruto y se la envía al frontend.
El frontend abre la extensión de la Freighter Wallet del usuario, quien revisa la transacción y la firma.
Toda la lógica de pago ocurre en Soroban. Ni el backend ni el frontend gestionan el dinero directamente.

### 3. Sincronización (Indexador)
Mientras tanto, el script del `indexer` en el backend escucha la red de Stellar.
Apenas la transacción de compra se procesa en un bloque, detecta el evento `BoletoComprado` o `BoletoRevendido` emitido por el Smart Contract y actualiza la tabla de base de datos PostgreSQL, reflejando instantáneamente en la interfaz que el usuario es dueño del boleto.

---

## Cómo empezar el entorno de desarrollo

### Requisitos
- **Node.js** (v20+)
- **Rust** y **Soroban CLI**
- **Docker** o una BD local **PostgreSQL**
- La extensión **Freighter** en el navegador, configurada para **Testnet**.

### Pasos
Consulte la documentación específica de cada carpeta para compilar o ejecutar el proyecto:
- [Documentación Técnica de Smart Contracts (Soroban)](./contracts/DOCUMENTACION_CONTRATOS.md)
- [Documentación del Backend y Proxy](./backend/README.md) (Próximamente)

> **Nota para evaluadores**: Todas las transacciones de esta demo se ejecutan en la **Stellar Testnet**, utilizando tokens y fee limits simulados.
```
