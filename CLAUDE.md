# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

This workspace contains one monorepo plus thesis documentation:

- `codigo/main_contract/` — **Monorepo** with smart contracts, backend, and frontend
- `documentos/Documento_Tesis/` — LaTeX thesis document and architecture diagrams

```
codigo/main_contract/
├── contracts/              # Rust/Soroban smart contracts (Cargo workspace)
├── backend/                # Node Express + Prisma + Soroban Indexer
├── frontend/               # React Vite + Tailwind + shadcn/ui + Freighter
├── docs/                   # Architecture & technical docs
├── .github/workflows/      # CI for Soroban contracts
├── HANDOVER_AI.md          # AI handover instructions
├── CONTRATOS_Y_DIRECCIONES.md  # Testnet deployment info
└── README.md               # Project overview
```

**Architecture: Web2.5 Hybrid** — Traditional Web2 UX (catalog, auth, cart) + Web3 ownership (Freighter signing, Soroban smart contracts, burn/remint traceability). The backend is a **stateless XDR proxy** that never holds private keys. The frontend signs transactions with Freighter wallet.

---

## Smart Contracts (Soroban / Stellar)

**Workspace root:** `codigo/main_contract/contracts/`

Cargo workspace with two contracts. `soroban-sdk = "23"`. Release profile: opt-level = "z", LTO, stripped, panic = "abort".

```
contracts/
├── Cargo.toml                          # Workspace config
├── contracts/
│   ├── event_contract/src/lib.rs       # ~1142 lines
│   ├── event_contract/src/test.rs      # ~709 lines, 35+ tests
│   ├── factory_contract/src/lib.rs     # ~431 lines
│   └── factory_contract/src/test.rs    # ~245 lines, 13 tests
├── DOCUMENTACION_CONTRATOS.md
├── ROADMAP_TECNICO_CONTRATOS.md
└── ESPECIFICACION_SIMULACION_ADMIN_OFFCHAIN.md
```

### Commands

```bash
cd codigo/main_contract/contracts
stellar contract build          # Compile both contracts to WASM
cargo test                      # Run all tests
cargo test <test_name>          # Run a single test
cargo fmt --all                 # Format all code
```

### event_contract — Gestión de boletos

**Core concept:** Contrato por evento que gestiona el ciclo de vida completo de boletos digitales con venta primaria, reventa atómica (burn/remint), y verificación en puerta.

**Todo el código está en español** (nombres de structs, funciones, variables, errores).

**Struct `Boleto`:** `ticket_root_id`, `version`, `id_evento`, `propietario` (Address), `precio` (i128), `en_venta`, `es_reventa`, `usado`, `invalidado`

**Storage keys (`ClaveDato`):** `Boleto(u32, u32)`, `VersionActual(u32)`, `ContadorBoletos`, `Organizador`, `Plataforma`, `TokenPago`, `ComisionOrganizador`, `ComisionPlataforma`, `Verificador(Address)`

**Funciones publicas:**
- `inicializar(organizador, plataforma, token_pago, comision_org, comision_plat)` — Setup unico
- `crear_boleto(id_evento, precio)` -> `u32` (ticket_root_id)
- `listar_boleto(ticket_root_id, nuevo_precio)` — Poner en venta
- `cancelar_venta(ticket_root_id)` — Retirar de venta
- `comprar_boleto(ticket_root_id, comprador)` -> `u32` (version) — Dos flujos:
  - **Venta primaria** (es_reventa=false): 100% al organizador, update in-place, marca es_reventa=true
  - **Reventa** (es_reventa=true): comisiones distribuidas (org + plataforma + vendedor), burn version vieja, remint version nueva
- `agregar_verificador(address)` / `remover_verificador(address)` / `es_verificador(address)` — Gestion de verificadores de puerta
- `redimir_boleto(ticket_root_id, verificador)` — Solo verificadores autorizados (no el owner)
- `invalidar_boleto(ticket_root_id)` — Cancelacion administrativa por organizador
- Consultas: `obtener_boleto`, `obtener_boleto_version`, `obtener_version_vigente`, `obtener_propietario`, `obtener_boletos_reventa` (O(n)), `obtener_boletos_evento` (O(n))

**Errores tipados (`ErrorContrato`, u32):**
1=YaInicializado, 2=ComisionesMuyAltas, 3=ComisionesNegativas, 4=PrecioInvalido, 5=YaEnVenta, 6=BoletoUsado, 7=NoEnVenta, 8=AutoCompra, 9=YaUsado, 10=BoletoNoEncontrado, 11=NoAutorizado, 12=VersionInvalida, 13=BoletoInvalidado, 14=NoInicializado, 15=VerificadorYaExiste, 16=VerificadorNoEncontrado

**Eventos on-chain:** BoletoCreado, BoletoListado, VentaCancelada, BoletoCompradoPrimario, BoletoRevendido, BoletoRedimido, BoletoInvalidadoEvt, VerificadorAgregado, VerificadorRemovido

**Key business rules:**
- Venta primaria: 100% al organizador, sin comision de plataforma
- Reventa: distribucion atomica de comisiones + burn/remint para trazabilidad
- `es_reventa` se marca `true` despues de la primera compra (no al listar)
- Boletos usados o invalidados no pueden venderse, comprarse ni redimirse
- Solo verificadores autorizados pueden redimir (no el propietario)
- `BASE_PORCENTAJE = 100` (i128)
- `require_auth()` en toda funcion que modifica estado

### factory_contract — Fabrica de contratos

**Core concept:** Patron Factory que despliega un event_contract independiente por cada evento.

**Struct `ConfiguracionEvento`:** `id_evento`, `organizador`, `token_pago`, `comision_organizador` (u32), `comision_plataforma` (u32), `wallet_organizador`, `wallet_plataforma`, `capacidad_total`

**Storage keys (`ClaveDato`):** `Administrador`, `ContadorEventos`, `HashWasmEvento`, `ContratoEvento(u32)`, `ContratoRegistrado(Address)`

**Funciones publicas:**
- `inicializar(administrador)` — Setup unico
- `configurar_wasm_evento(hash_wasm_evento: BytesN<32>)` — Guardar hash del WASM del event_contract
- `crear_evento_contrato(configuracion, direccion_evento_prueba)` -> Address — Deploy + init de event_contract. Requiere doble auth (admin + organizador)
- `obtener_contrato_evento(id_evento)` -> Address
- `obtener_contador_eventos()` -> u32
- `obtener_wasm_evento()` -> BytesN<32>

**Deploy:** `#[cfg(test)]` usa direccion pre-registrada; `#[cfg(not(test))]` usa `deployer().with_current_contract(salt).deploy_v2(hash, ())`. Salt = id_evento en big-endian (4 bytes) + zeros.

**Evento on-chain:** EventoCreado (id_evento, organizador, contrato_evento, capacidad_total)

### Contract dependencies & auth

- `soroban-sdk = "23"` (workspace), factory depends on event_contract (path)
- `require_auth()` gates every state-changing call
- event_contract: organizador (init, crear, verificadores, invalidar), propietario (listar, cancelar), comprador (comprar), verificador (redimir)
- factory_contract: administrador (init, wasm config, crear evento) + organizador (co-sign crear evento)

---

## Backend (Express + Prisma + Indexer)

**Root:** `codigo/main_contract/backend/`

**Stack:** Node.js + Express + TypeScript + Prisma ORM + PostgreSQL (Supabase) + Stellar SDK

**Status: FUNCTIONAL** — Backend compiles, runs, and connects to Supabase. Auth endpoints are mocked (fake JWT). Indexer runs in background.

### Commands

```bash
cd codigo/main_contract/backend
npm install                   # Install dependencies
npx prisma generate           # Generate Prisma client
npm run dev                   # Dev server with hot reload (tsx watch)
npm run build                 # Compile TypeScript to dist/
npm start                     # Run compiled output
```

### Files

- `package.json` — Dependencies: express, @prisma/client, @stellar/stellar-sdk, cors, dotenv
- `src/server.ts` — Express API (stateless XDR proxy + mocked Web2 endpoints)
- `src/indexer.ts` — Soroban event poller daemon (syncs blockchain -> DB)
- `prisma/schema.prisma` — Full hybrid Web2+Web3 database schema
- `prisma/seed.ts` — Disabled (DB hosted in Supabase, seeded externally)
- `tsconfig.json` — TypeScript config (target ES2021, commonjs, esModuleInterop)
- `.env.example` — Required env vars: DATABASE_URL, SOROBAN_RPC_URL, PORT

### API Endpoints (server.ts)

**Real endpoints (return DTO shape matching frontend `EventListItemDto`):**
- `GET /health` — Health check
- `GET /api/events` — List PUBLISHED events (transformed: category, city, venue, organizer, minPrice, startsAt)
- `GET /api/events/featured` — Top 6 events
- `GET /api/events/:slug` — Event detail + `live_tickets` (Web3 tickets with is_for_sale=true)
- `GET /api/events/:id/ticket-types` — Ticket types for an event
- `GET /api/events/:id/related` — Related events (same category, max 4)
- `POST /api/transactions/buy` — **XDR Builder**: returns unsigned transaction payload for Freighter signing

**Mocked endpoints (placeholders):**
- `POST /api/auth/login` — Fake JWT, hardcoded demo user
- `POST /api/auth/register` — Fake registration
- `GET /api/users/me` — Hardcoded demo user
- `POST /api/checkout/preview`, `POST /api/checkout/confirm` — Empty stubs
- `GET /api/orders`, `GET /api/tickets` — Empty arrays
- Cart CRUD (`GET/POST/DELETE/PATCH /api/cart/*`) — No-ops

### Indexer (indexer.ts)

Polls Soroban RPC every 5 seconds. Processes events from all contracts with `contract_address` in DB:

| Soroban Event | DB Action |
|---|---|
| `Mint` | Create ticket record (version 1, link wallet to user) |
| `Venta` | Set `is_for_sale = true` |
| `Compra` | Cancel old version, create new version with new owner |
| `Redimido` | Set status = USED |

- Tracks cursor in `indexer_state` table (last_ledger)
- On first run, starts 100 ledgers behind latest
- Chunks requests by 1000 ledgers max
- Error recovery: logs and retries after 5s

### Known limitations

1. **No real auth** — All endpoints public, mocked JWT (fake tokens, hardcoded demo user)
2. **No contract_address assigned** — All 11 events have `contract_address: null` (contracts not deployed to testnet yet)
3. **Cart/checkout mocked** — Cart CRUD and checkout are no-op stubs
4. **No event images** — DB has no image fields; frontend shows placeholder gray boxes

### Database Schema (Prisma)

**PostgreSQL schemas:** `public` + `ticketing`. Hosted on Supabase.

**Key models with Web3 fields:**

| Model | Web3 Fields |
|---|---|
| `users` | `wallet_address` (unique, optional) |
| `events` | `contract_address` (unique, nullable) |
| `tickets` | `contract_address`, `ticket_root_id`, `version`, `is_for_sale`, `owner_wallet`. Unique constraint: `(contract_address, ticket_root_id, version)` |
| `indexer_state` | `last_ledger` (cursor for Soroban sync) |

**Full Web2 models:** users (CUSTOMER/ADMIN), events, organizers, venues, venue_sections, seats, event_ticket_types, event_seat_inventory (AVAILABLE/HELD/SOLD/BLOCKED), carts, cart_items, seat_holds (TTL), orders, order_items, payments (CARD/PSE/CASHPOINT), tickets (ACTIVE/USED/CANCELLED/REFUNDED), event_categories, cities

**Enums:** document_type (CC/CE/TI/PP), event_status, user_role, cart_status, order_status, payment_method, payment_status, seat_hold_status, seat_inventory_status, ticket_status, venue_type

---

## Frontend (React + Vite + Freighter)

**Root:** `codigo/main_contract/frontend/`

**Stack:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui (Radix) + TanStack React Query + Framer Motion

**Web3 deps already installed:** `@stellar/freighter-api` ^6.0.1, `@stellar/stellar-sdk` ^14.6.1

### Commands

```bash
cd codigo/main_contract/frontend
npm run dev           # Dev server on localhost:8080
npm run build         # Production build
npm run test          # Vitest
npm run lint          # ESLint
```

### Routing (20 routes)

`/`, `/eventos`, `/eventos/:category`, `/buscar`, `/evento/:id`, `/evento/:id/boletas`, `/evento/:id/asientos`, `/carrito`, `/checkout`, `/confirmacion`, `/login`, `/registro`, `/mi-cuenta`, `/mi-cuenta/entradas`, `/mi-cuenta/compras`, `/mi-cuenta/perfil`, `/contactanos`, `*` (404)

### State & API (AppContext.tsx)

- React Context for cart, orders, purchased tickets, user data, JWT auth
- `apiFetch<T>(path, init?)` — Centralized fetch with Bearer token from `localStorage.authToken`
- `VITE_API_BASE_URL` (defaults to `http://localhost:3000`)
- API calls: auth (login/register/me), cart CRUD, checkout (preview/confirm), orders, tickets

### Key components

**Web3 integration (partially simulated for thesis demo):**
- `ConnectWallet.tsx` — Freighter wallet connection (isConnected, setAllowed, getPublicKey). Shown in header.
- `TicketCard.tsx` — "Reclamar en Web3" button (simulates Freighter signing + 2s delay), "Revender NFT" button (prompts USDC price), "Asegurado" badge
- `EventDetail.tsx` — "Reventa P2P Segura" section with mock NFT listing, Freighter buy flow for 50 USDC

**Layout:** Header (nav + ConnectWallet), Footer, HeroSearch, CategorySection, AccountSidebar

**UI:** EventCard, TicketCard, TicketSelector, SeatMap (3 sections: VIP/Platea/General), BannerCarousel, FilterPanel, PromoStrip, CheckoutStepper

**Pages:** Index (home + featured), EventsList (filter/search), EventDetail, TicketPurchase, SeatSelection, Cart, Checkout (3-step), Confirmation, Account, MyTickets, PurchaseHistory, Profile, Login, Register, Contact, SearchResults, NotFound

### Data fetching (src/data/events.ts)

- `getEvents(filters?)`, `getFeaturedEvents()`, `getEventBySlug(slug)`, `getEventById(id)`, `getRelatedEvents(eventId)`, `getEventTicketTypes(eventId)`
- Maps API responses to `EventData` type (dates parsed to Spanish month names, prices formatted as COP)
- Static banner data for carousel

---

## Documentation

**Technical docs:** `codigo/main_contract/docs/`
- `ARCHITECTURE.md` — Mermaid diagram: Frontend + Freighter -> Backend proxy -> DB + Indexer -> Soroban RPC -> Contracts
- `MODELO_DATOS.md` — Hybrid Web2.5 ERD (Web2 commerce + Web3 fields)
- `EVENTOS_ON_CHAIN.md` — Spec for on-chain events (TicketMinted, Listed, Resold, Redeemed, Cancelled, Invalidated) + idempotence pattern
- `ESTADO_ACTUAL_Y_PROXIMOS_PASOS.md` — Project status as of 2026-03-16
- `FASE_B_FACTORY_EVENT_SPLIT.md` — Factory/event split design
- `QUICK_REFERENCE.md` — Developer quick ref + phase timeline

**Thesis docs:** `documentos/Documento_Tesis/`
- `Memoria/` — Main LaTeX thesis (`main.tex` + chapter files)
- `diagramas/` — Mermaid architecture diagrams
- `SRS/`, `Plan_de_proyecto/`, `Propuesta_TG/` — Supporting documents

### CI

`.github/workflows/soroban.yml` — GitHub Actions: on push/PR to main, builds and tests both contracts with `wasm32-unknown-unknown` target.

---

## Web2.5 Integration Roadmap

### Completed
- **Phase 1** — Smart contracts: burn/remint, typed errors, verifier role, factory deploy, 48+ tests, CI
- **Phase 2** — Backend functional: Express proxy + Prisma + Indexer compiling and running, connected to Supabase (11 events, 26 users). package.json created, TS errors fixed, BigInt serialization fixed.
- **Phase 3 (partial)** — Frontend: full e-commerce flow (browse/cart/checkout/account), Freighter deps installed, ConnectWallet component, simulated Web3 buttons in TicketCard and EventDetail. Build succeeds (7 minor lint warnings).
- **Phase 3.5** — Frontend-backend wired: backend returns DTO matching frontend EventListItemDto (category, city, venue, organizer, minPrice, startsAt). Added /featured, /ticket-types, /related endpoints. Events from Supabase display correctly in UI.

### Pending — NEXT SESSION START HERE
- **Phase 3.6** — Implement real auth (replace mocked JWT with bcrypt + real tokens). Primary market fiat checkout working end-to-end. Add event images.
  - **BLOCKER**: `node_modules/plain-crypto-js` was locked by a process. On next session:
    1. Close VS Code and any terminals
    2. Run: `cmd /c "rd /s /q D:\Tesis\codigo\main_contract\backend\node_modules"`
    3. Then: `cd codigo/main_contract/backend && npm install bcryptjs jsonwebtoken @types/bcryptjs @types/jsonwebtoken && npm install && npx prisma generate`
    4. Continue implementing real auth in `src/server.ts` (replace mocked login/register/me with bcrypt + JWT)
- **Phase 3.6.1** — "Asegurar en Blockchain" button: real XDR construction + Freighter signing + submission to Soroban testnet
- **Phase 3.7** — Secondary market: real listar/comprar flow via Indexer-synced data
- **Phase 4** — Verifier UI for check-in, E2E demo scripts, latency/cost metrics (Stroops)
- **Phase 5** — Thesis documentation: updated architecture diagrams, Web2 problem mitigation analysis, test evidence

### Key architectural rules
- Backend is a **stateless XDR proxy** — builds unsigned Soroban transactions, never holds private keys
- Frontend signs with **Freighter wallet** and submits to Stellar network
- **Indexer** keeps PostgreSQL in sync with on-chain state (polls Soroban events every 5s)
- Web2 purchase flow (cart -> checkout -> order) remains intact; blockchain is an **opt-in layer** on top
- `payments.provider_reference` stores blockchain transaction hashes
- `tickets` table uses `(contract_address, ticket_root_id, version)` unique constraint to mirror on-chain state
