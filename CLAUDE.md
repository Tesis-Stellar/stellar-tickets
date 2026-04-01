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

- `package.json` — Dependencies: express, @prisma/client, @stellar/stellar-sdk, cors, dotenv, bcryptjs, jsonwebtoken
- `src/server.ts` — Express API (XDR proxy + real auth + checkout + Soroban integration)
- `src/indexer.ts` — Soroban event poller daemon (syncs blockchain -> DB)
- `prisma/schema.prisma` — Full hybrid Web2+Web3 database schema
- `prisma/seed.ts` — Disabled (DB hosted in Supabase, seeded externally)
- `tsconfig.json` — TypeScript config (target ES2021, commonjs, esModuleInterop)
- `.env.example` — Required env vars: DATABASE_URL, SOROBAN_RPC_URL, PORT, JWT_SECRET, ORGANIZER_SECRET

### API Endpoints (server.ts)

**Real endpoints (return DTO shape matching frontend `EventListItemDto`):**
- `GET /health` — Health check
- `GET /api/events` — List PUBLISHED events (transformed: category, city, venue, organizer, minPrice, startsAt)
- `GET /api/events/featured` — Top 6 events
- `GET /api/events/:slug` — Event detail + `live_tickets` (Web3 tickets with is_for_sale=true)
- `GET /api/events/:id/ticket-types` — Ticket types for an event
- `GET /api/events/:id/related` — Related events (same category, max 4)
- `POST /api/transactions/buy` — **XDR Builder**: returns unsigned transaction payload for Freighter signing
- `POST /api/transactions/secure-ticket` — **Soroban on-chain registration**: calls `crear_boleto` on event contract (organizer-signed server-side), updates DB with `contract_address`, `ticket_root_id`, `version`. Returns `{txHash, contractAddress, ticketRootId}`. Auth required.

**Auth endpoints (real bcrypt + JWT):**
- `POST /api/auth/login` — bcrypt.compare against DB `password_hash`, returns JWT (7d expiry) + user DTO
- `POST /api/auth/register` — bcrypt.hash(10 rounds), creates user in DB, returns JWT + user DTO. Checks duplicate email (409).
- `GET /api/users/me` — Protected by `authMiddleware` (Bearer JWT), returns user DTO from DB
- `PATCH /api/users/me` — Update profile (firstName, lastName, phone, documentType, documentNumber)
- `authMiddleware` — Extracts `userId` from JWT, attaches to `req.userId`. Returns 401 on missing/invalid token.

**Cart endpoints (real, auth required):**
- `GET /api/cart` — List items in user's active cart (with event + ticketType data for frontend)
- `POST /api/cart/items` — Add item `{ticketTypeId, quantity}`. Auto-creates cart if none exists. DB check constraint: only general-admission ticket types (no `venue_section_id`) can be added by quantity.
- `PATCH /api/cart/items/:id` — Update quantity
- `DELETE /api/cart/items/:id` — Remove single item
- `DELETE /api/cart/clear` — Remove all items from active cart

**Checkout endpoints (real, auth required):**
- `POST /api/checkout/preview` — Validate cart, return `{subtotal, serviceFees, total, itemCount}`
- `POST /api/checkout/confirm` — Atomic transaction: creates `orders` + `order_items` + `tickets` + `payments`, marks cart as CONVERTED. Payment simulated as PAID (thesis demo). Returns `{id, orderNumber, subtotal, serviceFees, total}`.

**Order & ticket endpoints (real, auth required):**
- `GET /api/orders` — User's order history `{id, orderNumber, createdAt, total, subtotal, serviceFees, status}`
- `GET /api/tickets` — User's active tickets with event + ticketType data + Web3 fields (`isSecuredOnChain`, `contractAddress`, `ticketRootId`, `version`, `ownerWallet`)

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
- Chunks contract IDs by 5 per filter (Soroban RPC limit)
- Error recovery: logs and retries after 5s

### Known limitations

1. **On-chain registration is organizer-signed** — `crear_boleto` is signed server-side with organizer key. Ticket is created on-chain owned by organizer (not user's wallet). Full wallet-to-wallet transfer requires `listar_boleto` + `comprar_boleto` flow (Phase 3.7).
2. **Seated events cart constraint** — DB check constraint requires `event_seat_inventory_id` for ticket types with `venue_section_id`. Only general-admission events work with the current cart flow.
3. **Event images are hardcoded** — No DB column; images mapped by slug in `EVENT_IMAGES` dict in server.ts (Unsplash URLs). Fallback by category via `CATEGORY_IMAGES`.
4. **node_modules workaround** — `plain-crypto-js` directory lock on Windows prevented normal `npm install`. Dependencies were installed via `npx yarn install` (yarn.lock present). If issues recur, delete node_modules fully and re-run `npx --yes yarn install && npx prisma generate`.

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
- API calls: auth (login/register/me), cart CRUD, checkout (preview/confirm), orders, tickets, `secureTicketOnChain`

### Key components

**Web3 integration:**
- `ConnectWallet.tsx` — Freighter wallet connection (isConnected, setAllowed, getPublicKey). Shown in header.
- `TicketCard.tsx` — "Asegurar en Blockchain" button calls `POST /api/transactions/secure-ticket` → real Soroban `crear_boleto` → shows "Asegurado en Blockchain" badge + Stellar Explorer link. "Revender NFT" button (placeholder for Phase 3.7).
- `EventDetail.tsx` — "Reventa P2P Segura" section (placeholder for Phase 3.7)
- `AppContext.tsx` — `secureTicketOnChain(ticketId)` function, `PurchasedTicket` type includes Web3 fields (`isSecuredOnChain`, `contractAddress`, `ticketRootId`, `version`, `ownerWallet`)

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

`.github/workflows/soroban.yml` — GitHub Actions: on push/PR to main. Uses `cargo-binstall` for pre-built `stellar-cli`, builds each contract individually (`--package`) to avoid symbol collision on `wasm32v1-none` target. Runs `cargo test`, uploads WASM artifacts.

### Testnet Deployment

**Script:** `backend/scripts/deploy-contracts.ts` — Deploys event_contract instances to Stellar Testnet.

**Flow:** Generate keypairs → fund via Friendbot → upload WASM → deploy one contract per event → `inicializar()` each → update DB `contract_address`.

**Key details:**
- WASM hash: `32fbb9bf4e7f803c1e5caf3c2744e1efedb51975fd2775ebdfe1475e999bb0ef`
- Native XLM token: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- Comisiones: 5% organizador, 3% plataforma (passed as `i128`)
- Organizer must be source account for `inicializar` (satisfies `require_auth()`)
- Keypairs saved to `backend/.env.deploy` (gitignored)
- 11/11 contracts deployed and initialized (2026-03-31)

---

## Web2.5 Integration Roadmap

### Completed
- **Phase 1** — Smart contracts: burn/remint, typed errors, verifier role, factory deploy, 48+ tests, CI
- **Phase 2** — Backend functional: Express proxy + Prisma + Indexer compiling and running, connected to Supabase (11 events, 26 users). package.json created, TS errors fixed, BigInt serialization fixed.
- **Phase 3 (partial)** — Frontend: full e-commerce flow (browse/cart/checkout/account), Freighter deps installed, ConnectWallet component, simulated Web3 buttons in TicketCard and EventDetail. Build succeeds (7 minor lint warnings).
- **Phase 3.5** — Frontend-backend wired: backend returns DTO matching frontend EventListItemDto (category, city, venue, organizer, minPrice, startsAt). Added /featured, /ticket-types, /related endpoints. Events from Supabase display correctly in UI.
- **Phase 3.6 (auth)** — Real auth implemented (2026-03-30): bcryptjs + jsonwebtoken replace mocked endpoints. Login verifies password_hash from DB, register hashes with bcrypt(10), /users/me protected by JWT middleware. Dependencies installed via yarn workaround. TypeScript compiles clean, server starts OK.
- **Phase 3.6 (checkout)** — Full fiat checkout implemented (2026-03-31): Cart CRUD persisted to DB (carts + cart_items), checkout creates orders + order_items + tickets + payments atomically, cart marked CONVERTED after purchase. Orders and tickets endpoints return real data. Frontend bugs fixed: Checkout Field component extracted to prevent focus loss, TicketCard venue object rendering fixed. Tested end-to-end (GA events).
- **Phase 3.6 (deploy)** — 11 Soroban contracts deployed to Stellar Testnet (2026-03-31): CI fixed (cargo-binstall, wasm32v1-none, per-package build), deploy script created and debugged (i128 comisiones, organizer source account for require_auth). All events in DB now have `contract_address`.
- **Phase 3.6.1 (secure on-chain)** — "Asegurar en Blockchain" working end-to-end (2026-03-31): Backend `POST /api/transactions/secure-ticket` calls `crear_boleto` on Soroban testnet (organizer-signed), updates DB with on-chain data. Frontend TicketCard shows real "Asegurado en Blockchain" badge + Stellar Explorer link. Indexer fixed for 11 contracts (5-per-filter chunking). Tested and verified on testnet.

### Pending — NEXT SESSION START HERE
- **Phase 3.7** — Secondary market: real `listar_boleto`/`comprar_boleto` flow with Freighter signing + Indexer-synced data
- **Phase 4** — Verifier UI for check-in, E2E demo scripts, latency/cost metrics (Stroops)
- **Phase 5** — Thesis documentation: updated architecture diagrams, Web2 problem mitigation analysis, test evidence

### Key architectural rules
- Backend signs `crear_boleto` server-side with organizer key (on-chain registration). For user-facing operations (buy/resale), backend builds unsigned XDR and frontend signs with **Freighter wallet**
- `ORGANIZER_SECRET` env var required for on-chain ticket creation
- **Indexer** keeps PostgreSQL in sync with on-chain state (polls Soroban events every 5s)
- Web2 purchase flow (cart -> checkout -> order) remains intact; blockchain is an **opt-in layer** on top
- `payments.provider_reference` stores blockchain transaction hashes
- `tickets` table uses `(contract_address, ticket_root_id, version)` unique constraint to mirror on-chain state
