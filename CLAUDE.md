# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> ⚠️ **PATHS — read first.** El código activo vive en `D:\Tesis\Codigo\main_contract\backend` y `D:\Tesis\Codigo\main_contract\frontend`. **NO** trabajes en `D:\Tesis\backend\` ni `D:\Tesis\frontend\` — son copias viejas/stale; cualquier edición ahí no afecta al backend que corre en `localhost:3000` ni al Vite dev server.

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

**Status: FUNCTIONAL** — Backend compiles, runs, and connects to Supabase. Real auth (bcrypt + JWT). Full Soroban integration (secure, list, buy). Indexer runs in background.

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
- `GET /` — Root: texto plano indicando que es la API (para Vercel health y diagnóstico)
- `GET /health` — Health check
- `GET /api/events` — List PUBLISHED events (transformed: category, city, venue, organizer, minPrice, startsAt)
- `GET /api/events/featured` — Top 6 events
- `GET /api/events/:slug` — Event detail + `live_tickets` (Web3 tickets with is_for_sale=true) + `ticketTypes` (formatted, eliminates extra call). Cached 30s.
- `GET /api/events/:id/ticket-types` — Ticket types for an event
- `GET /api/events/:id/related` — Related events (same category, max 4). Cached 60s.
- `POST /api/transactions/buy` — **XDR Builder**: returns unsigned transaction payload for Freighter signing
- `POST /api/transactions/secure-ticket` — **Soroban on-chain registration**: calls `crear_boleto` on event contract (organizer-signed server-side), updates DB with `contract_address`, `ticket_root_id`, `version`, `owner_wallet` (user's wallet, not organizer's). Returns `{txHash, contractAddress, ticketRootId}`. Auth required.
- `POST /api/transactions/list-ticket` — **Soroban list for resale**: calls `listar_boleto` on-chain (organizer-signed). Accepts `{ticketId, price}` (price in stroops). Updates DB `is_for_sale = true`, `resale_price`, `owner_wallet`. Auth required.
- `POST /api/transactions/cancel-listing` — **Soroban cancel resale**: calls `cancelar_venta` on-chain (organizer-signed). Accepts `{ticketId}`. Updates DB `is_for_sale = false`, `resale_price = null`. Auth required.
- `POST /api/transactions/build-buy-xdr` — **XDR Builder for resale**: builds unsigned `comprar_boleto` transaction with buyer as source account. Returns `{xdr, networkPassphrase}` for Freighter signing. User-friendly error on insufficient balance. Auth required.
- `POST /api/transactions/submit` — Receives Freighter-signed XDR, submits to Soroban RPC, polls for result. Returns `{success, txHash}`. Auth required.

**Auth endpoints (real bcrypt + JWT):**
- `POST /api/auth/login` — bcrypt.compare against DB `password_hash`, returns JWT (7d expiry) + user DTO
- `POST /api/auth/register` — bcrypt.hash(10 rounds), creates user in DB, returns JWT + user DTO. Checks duplicate email (409).
- `GET /api/users/me` — Protected by `authMiddleware` (Bearer JWT), returns user DTO from DB (includes `walletAddress`)
- `PATCH /api/users/me` — Update profile (firstName, lastName, phone, documentType, documentNumber)
- `PATCH /api/users/me/wallet` — Link Freighter wallet address to user account. Auth required.
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
- `GET /api/tickets/sold` — Tickets the user sold via P2P resale (status CANCELLED + resale_price not null). Includes `buyerWallet` (looked up from next version of same ticket_root_id), `resalePrice` (stroops), event + ticketType data. Auth required.

**Performance: In-memory cache** — `cached(key, ttlMs, fn)` helper caches DB results in a Map. `invalidateCache(prefix?)` clears entries. Events list + featured cached 60s, event detail 30s, related 60s. Live tickets (resale) are NOT cached. `connection_limit=5` in DATABASE_URL (was 1, caused pool timeouts).

**Admin endpoints (ADMIN role required unless noted):**
- `GET /api/admin/venues` — List all venues with their sections (id, name, capacity)
- `GET /api/admin/events` — All events regardless of status (not filtered to PUBLISHED)
- `POST /api/admin/events` — Create new event `{title, slug, category_id, date, venue_id, sections[]}`. Auto-creates event_ticket_types per section. Invalidates cache.
- `POST /api/admin/events/:id/deploy` — Run deploy script for event, update `contract_address` in DB. Returns `{success, contractAddress, log}`.
- `GET /api/admin/contracts` — Returns `{factoryContractId, events[]}` where `factoryContractId` comes from `FACTORY_CONTRACT_ID` env var and events are those with `contract_address != null`.
- `POST /api/admin/scan` — **ADMIN or STAFF**: Redeem ticket by `{ticketId}`. Validates ticket exists + status=ACTIVE, marks CANCELLED. **Note:** DB-only scan (no on-chain `redimir_boleto` call) to avoid gate delays in thesis demo.

### Indexer (indexer.ts)

Polls Soroban RPC every 5 seconds. Processes events from all contracts with `contract_address` in DB:

| Soroban Event (snake_case) | DB Action |
|---|---|
| `boleto_creado` | Create ticket record if not already tracked |
| `boleto_listado` | Set `is_for_sale = true` |
| `venta_cancelada` | Set `is_for_sale = false` |
| `boleto_comprado_primario` | If ticket has `resale_price` (P2P sale): cancel seller ticket + create new ticket for buyer (version+1, copies `order_item_id`). Otherwise: update owner in-place (normal primary sale) |
| `boleto_revendido` | Cancel old version (preserves `resale_price`), create new version with new owner (copies `order_item_id`) |
| `boleto_redimido` | Set status = USED |
| `boleto_invalidado_evt` | Set status = CANCELLED |

- Tracks cursor in `indexer_state` table (last_ledger)
- On first run, starts 100 ledgers behind latest
- Chunks requests by 1000 ledgers max
- Chunks contract IDs by 5 per filter (Soroban RPC limit)
- **Auto-recovery from ledger range errors**: el RPC público solo retiene ledgers recientes. Si el cursor cae fuera del rango válido, el indexer parsea el mensaje de error (`parseRpcLedgerRangeError`), ajusta `last_ledger` al mínimo/máximo permitido y continúa automáticamente.
- **Solo corre en entornos long-lived** — si `VERCEL=1`, el `app.listen()` no se ejecuta y el indexer tampoco arranca (serverless no soporta procesos de fondo).
- Error recovery: logs and retries after 5s

### Known limitations

1. **On-chain registration is organizer-signed** — `crear_boleto`, `listar_boleto`, and `cancelar_venta` are signed server-side with organizer key. `comprar_boleto` is signed by buyer via Freighter.
2. **Seated events resolved** — All 11 events converted to GA via `backend/scripts/fix-seated-events.ts`. Original seated-events constraint (required `event_seat_inventory_id`) is no longer a blocker.
3. **Event images are hardcoded** — No DB column; images mapped by slug in `EVENT_IMAGES` dict in server.ts (Unsplash URLs). Fallback by category via `CATEGORY_IMAGES`.
4. **node_modules workaround** — `plain-crypto-js` directory lock on Windows prevented normal `npm install`. Dependencies were installed via `npx yarn install` (yarn.lock present). If issues recur, delete node_modules fully and re-run `npx --yes yarn install && npx prisma generate`.
5. **One Freighter wallet per browser** — Freighter extension has one active wallet. If a wallet is already linked to user A, user B logging in on the same browser will see a 409 error and the wallet won't connect. Use incognito or switch Freighter accounts.
6. **Admin scan is DB-only** — `POST /api/admin/scan` marks ticket CANCELLED in DB but does NOT call `redimir_boleto` on Soroban. Chosen for demo speed; on-chain redemption would add ~5s latency at the gate.
7. **Render/Vercel deploy config** — Production uses `tsx src/server.ts` as start command. `stellar-sdk` pinned to `14.4.1`. `tsconfig.json` has `incremental: false`. Vercel deployment via `backend/api/index.ts`.
8. **JWT_SECRET es requerido en producción** — Si `NODE_ENV=production` y `JWT_SECRET` no está en el env, el servidor lanza error al arrancar. En desarrollo muestra warning pero usa fallback inseguro.

### Database Schema (Prisma)

**PostgreSQL schema:** `ticketing` (all tables). Hosted on Supabase.

**Key models with Web3 fields:**

| Model | Web3 Fields |
|---|---|
| `users` | `wallet_address` (unique, optional) |
| `events` | `contract_address` (unique, nullable) |
| `tickets` | `contract_address`, `ticket_root_id`, `version`, `is_for_sale`, `resale_price` (BigInt, stroops), `owner_wallet`. Unique constraint: `(contract_address, ticket_root_id, version)` |
| `indexer_state` | `last_ledger` (cursor for Soroban sync) |

**NOTE:** `resale_price` column was added via migration script (`backend/scripts/migrate-tickets.ts`), not via `prisma migrate`. The DB diagram in thesis docs needs updating to reflect this column.

**Full Web2 models:** users (CUSTOMER/ADMIN/STAFF), events, organizers, venues, venue_sections, seats, event_ticket_types, event_seat_inventory (AVAILABLE/HELD/SOLD/BLOCKED), carts, cart_items, seat_holds (TTL), orders, order_items, payments (CARD/PSE/CASHPOINT), tickets (ACTIVE/USED/CANCELLED/REFUNDED), event_categories, cities

**Enums:** document_type (CC/CE/TI/PP), event_status, user_role (**CUSTOMER/ADMIN/STAFF** — STAFF added in Phase 4), cart_status, order_status, payment_method, payment_status, seat_hold_status, seat_inventory_status, ticket_status, venue_type

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

### Routing (23 routes)

`/`, `/eventos`, `/eventos/:category`, `/buscar`, `/evento/:id`, `/evento/:id/boletas`, `/evento/:id/asientos`, `/carrito`, `/checkout`, `/confirmacion`, `/login`, `/registro`, `/mi-cuenta`, `/mi-cuenta/entradas`, `/mi-cuenta/compras`, `/mi-cuenta/ventas-p2p`, `/mi-cuenta/perfil`, `/contactanos`, `/admin` (ADMIN only), `/escanear` (ADMIN/STAFF), `*` (404)

### State & API (AppContext.tsx)

- React Context for cart, orders, purchased tickets, sold tickets, user data, JWT auth
- `apiFetch<T>(path, init?)` — Centralized fetch with Bearer token from `localStorage.authToken`. **Now exposed in context** so admin/scanner pages can call API endpoints directly.
- `VITE_API_BASE_URL` (defaults to `http://localhost:3000`)
- API calls: auth (login/register/me), cart CRUD, checkout (preview/confirm), orders, tickets, `secureTicketOnChain`, `listTicketForSale`, `cancelResaleListing`, `buyResaleTicket`, `linkWallet`
- `walletAddress` / `setWalletAddress` — Shared wallet state. Loaded from user profile (`/api/users/me` returns `walletAddress`) on login/refresh, AND from Freighter on connect. Consumed by EventDetail for resale purchases and seller detection.
- `soldTickets` — `SoldTicket[]` state fetched from `GET /api/tickets/sold`. Each has `buyerWallet`, `resalePrice` (stroops), event data.
- `refreshTickets()` / `refreshSoldTickets()` — Reusable callbacks to re-fetch ticket lists. Called with 7s delay after `buyResaleTicket` (indexer polling cycle).
- `balanceVersion` — Counter incremented after buy/list/cancel, triggers ConnectWallet to re-fetch XLM balance from Horizon.
- `mapTicketsResponse()` — Extracted helper for ticket mapping (de-duplicated from initial load + checkout).
- Checkout refreshes tickets via `refreshTickets()` after confirm to get real DB UUIDs (no more fake `ticket-xxx` IDs)
- `UserData.role` — `"CUSTOMER" | "ADMIN" | "STAFF"`. Loaded from `/api/users/me` (`toUserDto` returns `role`). Used by Header and admin pages to gate access.
- `PurchasedTicket.ticketCode` — Optional field, populated if returned by API.

### Key components

**Web3 integration:**
- `ConnectWallet.tsx` — **Only renders when user is logged in.** Freighter wallet connection via dynamic import. Uses Freighter v6 API (`isConnected`, `isAllowed`, `getAddress`, `requestAccess`). Auto-links wallet to backend on connect via `linkWallet()`. Handles 409 (wallet already linked to another account) with user-friendly alert. Shows XLM balance + COP equivalent (via `useXlmPrice` hook). Balance refreshes on `balanceVersion` change.
- `TicketCard.tsx` — "Asegurar en Blockchain" button calls `POST /api/transactions/secure-ticket` → real Soroban `crear_boleto` → shows "Asegurado en Blockchain" badge + Stellar Explorer link. "Revender NFT" button calls `POST /api/transactions/list-ticket` → shows "En Venta" badge + **"Cancelar Reventa"** button (calls `cancelResaleListing`).
- `EventDetail.tsx` — "Reventa P2P Segura" section shows live tickets with **resale price in XLM + COP equivalent**. If `walletAddress === sellerWallet`: shows **"Cancelar Reventa"** (red button). Otherwise: shows "Comprar" button → `buyResaleTicket` → backend builds XDR → Freighter signs → backend submits to Soroban. Uses `ticketTypes` from detail response (avoids extra API call).
- `AppContext.tsx` — `secureTicketOnChain`, `listTicketForSale`, `cancelResaleListing`, `buyResaleTicket`, `linkWallet`, `refreshTickets` functions. `PurchasedTicket` and `SoldTicket` types. `walletAddress` loaded from user profile AND Freighter.

**Layout:** Header (nav + ConnectWallet + Admin/Scanner links for ADMIN/STAFF), Footer, HeroSearch, CategorySection, AccountSidebar

**UI:** EventCard, TicketCard, TicketSelector, SeatMap (3 sections: VIP/Platea/General), BannerCarousel, FilterPanel, PromoStrip, CheckoutStepper

**Hooks:**
- `useXlmPrice.ts` — Fetches XLM/COP price from CoinGecko API, cached in localStorage for 5 minutes. Exports `useXlmPrice()` (returns COP price or null), `formatCOP(amount)`, `stroopsToXLM(stroops)`.

**Pages:** Index (home + featured), EventsList (filter/search), EventDetail, TicketPurchase, SeatSelection, Cart, Checkout (3-step), Confirmation, Account, MyTickets, MySalesP2P, PurchaseHistory, Profile, Login, Register, Contact, SearchResults, NotFound, **AdminDashboard** (`/admin`, ADMIN only), **ScannerPage** (`/escanear`, ADMIN/STAFF)

### Data fetching (src/data/events.ts)

- `getEvents(filters?)`, `getFeaturedEvents()`, `getEventBySlug(slug)`, `getEventById(id)`, `getRelatedEvents(eventId)`, `getEventTicketTypes(eventId)`
- `getEventBySlug` now uses `ticketTypes` from detail response if available (avoids extra `/ticket-types` call)
- Maps API responses to `EventData` type (dates parsed to Spanish month names, prices formatted as COP)
- Static banner data for carousel

---

## Documentation

**Technical docs restructurados en `docs/` (reorganizados 2026-04-20):**

```
docs/
├── README.md                        # Índice general
├── architecture/                    # Diseño técnico
│   ├── ARCHITECTURE.md              # Diagrama Mermaid del sistema
│   ├── CONTRACTS_TECHNICAL_REFERENCE.md
│   ├── EVENTOS_ON_CHAIN.md
│   ├── MODELO_DATOS.md
│   └── ADMIN_OFFCHAIN_SIMULATION_SPEC.md
├── archive/                         # Documentos históricos
│   ├── CLAUDE.md                    # Versión anterior de este archivo
│   ├── HANDOVER_AI.md
│   ├── QUICK_REFERENCE.md
│   └── ...
├── audits/                          # Auditorías de código
│   ├── BACKEND_AUDIT.md
│   ├── CONTRACTS_AUDIT.md
│   └── FRONTEND_AUDIT.md
├── backlog/                         # Backlogs por área
│   ├── PROJECT_BACKLOG.md
│   ├── BACKEND_BACKLOG.md
│   ├── CONTRACTS_BACKLOG.md
│   └── FRONTEND_BACKLOG.md
├── operations/
│   ├── DEVELOPMENT_WORKFLOW.md
│   ├── TESTNET_DEPLOYMENTS.md       # (era CONTRATOS_Y_DIRECCIONES.md)
│   └── WALLETS_ROLES_TESTNET.md
└── setup/
    ├── ONBOARDING.md
    ├── DOCKER_CLI_WORKFLOW.md
    └── UPDATE_POLICY.md
```

**Tooling scripts:** `tooling/`
- `bootstrap-check.sh` — Verifica entorno de desarrollo
- `health-check.sh` — Verifica servicios activos
- `contracts-docker.sh` — Compila contratos Soroban en Docker (sin instalar Rust localmente)
- `docker/stellar-contracts.Dockerfile` — Imagen Docker para build de contratos

**Thesis docs:** `documentos/Documento_Tesis/`
- `Memoria/` — Main LaTeX thesis (`main.tex` + chapter files)
- `diagramas/` — Mermaid architecture diagrams
- `SRS/`, `Plan_de_proyecto/`, `Propuesta_TG/` — Supporting documents

### CI

`.github/workflows/soroban.yml` — GitHub Actions: on push/PR to main. Uses `cargo-binstall` para `stellar-cli` pre-compilado, builds cada contrato individualmente (`--package`) para evitar colisión de símbolos en `wasm32v1-none`. Corre `cargo test`, sube artefactos WASM.

**Vercel deployment:** `frontend/vercel.json` y `backend/vercel.json` añadidos. Backend se sirve via `backend/api/index.ts` (re-export del server). Frontend con SPA rewrites.

**DevContainer:** `.devcontainer/` con Dockerfile + postCreate.sh para entorno de desarrollo reproducible en VS Code / GitHub Codespaces.

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

- **Phase 3.7 (secondary market)** — Full resale marketplace working end-to-end on Soroban testnet (2026-03-31). Backend: `POST /api/transactions/list-ticket` (organizer-signed `listar_boleto`), `POST /api/transactions/build-buy-xdr` (unsigned XDR for `comprar_boleto`), `POST /api/transactions/submit` (signed XDR submission), `PATCH /api/users/me/wallet` (link Freighter). Frontend: ConnectWallet rewritten for Freighter v6 API (objects not primitives), `walletAddress` shared via AppContext, TicketCard "Revender NFT" button with real on-chain listing, EventDetail "Reventa P2P Segura" section with live marketplace + Freighter-signed purchases, self-purchase prevention. Indexer updated with all 7 snake_case event handlers. Tested: listing + purchase confirmed on testnet (tx `3f93a54c3a66...`).

- **Phase 3.8 (resale UX polish)** — Implemented 2026-04-02:
  - **Wallet-user binding**: ConnectWallet only renders when logged in, auto-links wallet to backend on connect. Handles 409 (duplicate wallet across accounts). `walletAddress` loaded from user profile on login (not just Freighter), so seller detection works even without extension open.
  - **Cancel listing flow**: New `POST /api/transactions/cancel-listing` endpoint calls `cancelar_venta` on-chain. `cancelResaleListing` in AppContext. "Cancelar Reventa" button in both TicketCard (Mis Entradas) and EventDetail (P2P marketplace when seller views own listing).
  - **Resale price display**: New `resale_price` (BigInt) column on `tickets` table. Stored in stroops on list, cleared on cancel. EventDetail P2P section shows price in XLM.
  - **Post-checkout refresh**: After checkout/confirm, frontend fetches real tickets from `GET /api/tickets` to get DB UUIDs instead of fake `ticket-xxx` IDs. Fixes "Asegurar en Blockchain" failing with UUID parse error.
  - **owner_wallet fix**: `secure-ticket` and `list-ticket` now save user's `wallet_address` (not organizer key) as `owner_wallet`. Migration script `backend/scripts/migrate-tickets.ts` fixes existing records.
  - **Event images in Mis Entradas**: Fixed mapping `posterImage` → `image` when loading tickets from API.
  - **Register form focus fix**: Extracted `Field` component outside `Register` to prevent re-mount on each keystroke.
  - **Better buy errors**: `build-buy-xdr` detects insufficient balance and returns user-friendly message.
  - **DB migration**: `resale_price BIGINT` column added to `ticketing.tickets`. Run `node --import tsx scripts/migrate-tickets.ts` from backend dir to apply (also fixes `owner_wallet`).

- **Phase 3.9 (P2P sales, COP balance, performance)** — Implemented 2026-04-03:
  - **Mis Ventas P2P page** (`/mi-cuenta/ventas-p2p`): New page showing completed P2P sales with buyer wallet address, event info, amount received in XLM + COP equivalent. Summary card with total earnings. Added to AccountSidebar + Account panel.
  - **XLM/COP conversion**: `useXlmPrice` hook fetches XLM/COP from CoinGecko (cached 5min in localStorage). Displayed in ConnectWallet header, MySalesP2P page, and EventDetail resale prices.
  - **Sold tickets endpoint** (`GET /api/tickets/sold`): Returns tickets with `status: CANCELLED` + `resale_price != null`. Looks up `buyerWallet` from next version of same `ticket_root_id`.
  - **Indexer fix for P2P primary sales**: `boleto_comprado_primario` handler now detects P2P sales (ticket has `resale_price`) and cancels seller ticket + creates buyer ticket (like `boleto_revendido`). Previously it just updated owner in-place, leaving no sale record.
  - **Indexer preserves order_item_id**: Both `boleto_comprado_primario` (P2P) and `boleto_revendido` handlers now copy `order_item_id` from old ticket to new ticket, preserving event data linkage for the buyer.
  - **Post-purchase auto-refresh**: `refreshTickets()` and `refreshSoldTickets()` reusable callbacks. Called 7s after `buyResaleTicket` (indexer polling delay). `balanceVersion` counter triggers ConnectWallet balance re-fetch.
  - **Backend in-memory cache**: `cached(key, ttlMs, fn)` caches events list (60s), featured (60s), event detail (30s), related (60s). Live tickets NOT cached. Reduces Supabase round-trips (~150ms each from Colombia to US West).
  - **Event detail includes ticketTypes**: `/api/events/:slug` now returns formatted `ticketTypes`, eliminating the separate `/ticket-types` API call from frontend.
  - **Connection pool fix**: `connection_limit=5` (was 1) in DATABASE_URL prevents Prisma pool timeouts when indexer + API compete for connections.
  - **AppContext refactor**: Extracted `mapTicketsResponse()` helper, `refreshTickets()` callback. Checkout uses `refreshTickets()` instead of duplicated mapping code.

- **Phase 4 (admin panel + scanner)** — Implemented 2026-04-04:
  - **Admin Dashboard** (`/admin`): New page for ADMIN role. Shows all events with contract status, venues with sections, contracts panel (factory contract ID + Stellar Expert links for each deployed event contract). Allows creating new events with venue/section config and price per section. "Deploy to Soroban" button runs `deploy-contracts.ts` script server-side for events without a contract.
  - **QR Scanner** (`/escanear`): New page for ADMIN and STAFF roles. Uses `@yudiel/react-qr-scanner` (npm package added). Reads QR containing `{ticketId: uuid}` JSON. Calls `POST /api/admin/scan` → marks ticket CANCELLED in DB. Shows visual success/error with submessage. Scan is **DB-only** (no on-chain call) for speed.
  - **STAFF role**: Added `STAFF` to `user_role` enum in Prisma schema. STAFF can access Scanner but not Admin Dashboard.
  - **Admin/Scanner links in Header**: Header shows "Admin" (amber) and "Escáner" (green) nav links for ADMIN/STAFF users, hidden from CUSTOMER users.
  - **`apiFetch` exposed in AppContext**: `apiFetch` is now part of the AppState interface, allowing admin/scanner pages to call API endpoints directly via context.
  - **Wallet guard in TicketCard**: Added alert if user tries to "Asegurar en Blockchain" or "Revender NFT" without a connected Freighter wallet.
  - **All events converted to GA**: `backend/scripts/fix-seated-events.ts` script converted all 6 seated events to general admission so all 11 events are purchasable.
  - **User cleanup script**: `backend/scripts/clean-users.ts` resets users for demo recording.
  - **Render deploy fixes**: `stellar-sdk` pinned to `14.4.1`, start command uses `tsx src/server.ts` instead of compiled JS, `tsconfig.json` has `incremental: false`.

- **Phase 4.1 (seated events + wallet rotation + UX polish)** — Implemented 2026-05-02:
  - **Seat-based purchase flow restored**: Tras refactor previo dejó de funcionar `GET /api/events/:id/seats` (400 "Este evento no tiene selección de asientos"). Solucionado convirtiendo todos los eventos a asignación de asientos con `backend/scripts/seed-seat-inventory.ts` (idempotente): crea 3 secciones por venue (VIP 2×10, Platea 3×12, General 4×14), seats numerados, `event_seat_inventory` con status `AVAILABLE`, ticket_types atados a sección con `inventory_quantity = null`. Sets `events.has_assigned_seating = true`.
  - **Cart trigger fix**: El trigger `validate_cart_item_consistency` rechazaba inserts seat-based porque exigía `inventory_quantity NOT NULL` para cualquier `event_ticket_type_id`. Solucionado en `backend/scripts/fix-cart-trigger.ts` agregando guard `AND NEW.event_seat_inventory_id IS NULL` (solo valida quantity-based para flujo GA).
  - **set_updated_at restoration**: La función `ticketing.set_updated_at` se sobreescribió accidentalmente con la lógica del cart trigger, causando `column "new" does not exist` en cualquier UPDATE. Restaurada con `backend/scripts/restore-set-updated-at.ts` a su lógica trivial (`NEW.updated_at = NOW()`).
  - **Cart/order/ticket DTOs con seat-based fallback**: `cart_items`, `order_items` y `tickets` para flujo seat-based solo guardan `event_seat_inventory_id` (NO `event_ticket_type_id`) por el CHECK constraint `chk_cart_items_one_source` / `chk_order_items_one_source`. Endpoints `GET /api/cart`, `GET /api/tickets`, `POST /api/transactions/secure-ticket`, `GET /api/tickets/sold` ahora resuelven el `ticketType` y `event` vía `event_seat_inventory.event_ticket_types.events` cuando el join directo es null.
  - **Wallet rotation**: Las wallets demo del proyecto se rotaron a un set con 12 palabras documentadas en `.env.deploy` (ADMIN, ORGANIZER, PLATFORM, BUYER1, BUYER2, VERIFIER). El compañero las creó con nombres claros para trazabilidad de la tesis.
  - **Contract recompile + redeploy**: El WASM en `contracts/wasm/event_contract.wasm` era del 31-mar (pre commit 9361285 "ownership inconsistency fix") y NO contenía la función `crear_boleto_para` que llama el backend. Recompilado con `cargo build --release --target wasm32v1-none` (target Soroban-compatible; `wasm32-unknown-unknown` genera reference-types que Soroban rechaza). 12 contratos redesplegados en testnet con WASM nuevo + nuevas wallets organizer/admin.
  - **Deploy script refactor** (`backend/scripts/deploy-contracts.ts`):
    - Ya NO genera keypairs aleatorios; carga ADMIN/PLATFORM/ORGANIZER desde `.env.deploy`.
    - Salt aleatorio por contrato (evita colisión `ExistingValue` al redesplegar con mismo admin).
    - WASM_DIR apunta a `contracts/wasm/` (carpeta versionada) en vez del `target/release` local.
    - Antes del deploy, limpia `contract_address = null` en todos los eventos PUBLISHED para forzar redeploy.
  - **UI: precio de reventa en COP**: `TicketCard.tsx` reemplaza `prompt()` nativo con un `<Dialog>` shadcn/ui. Usuario ingresa precio en COP, ve preview en vivo del equivalente en XLM (usando `useXlmPrice`) y la cotización actual. Backend sigue recibiendo XLM/stroops; la conversión es solo UI. Mejora UX para usuarios no-cripto.
  - **ConnectWallet persistente entre navegaciones**: Cada página renderiza su propio `<Header />`, lo que remontaba `ConnectWallet` y mostraba "Connect Wallet" durante ~300-500ms al navegar. Refactorizado para leer `walletAddress` directamente del `AppContext` (persistente) en lugar de estado local. Solo invoca a Freighter cuando NO hay address en el context. Resultado: la wallet se mantiene visible al cambiar de pantalla y al recargar (gracias a que `/api/users/me` devuelve `walletAddress`).
  - **Critical path note**: El código activo vive en `D:\Tesis\Codigo\main_contract\backend|frontend`. NO trabajar en `D:\Tesis\backend\` ni `D:\Tesis\frontend\` — son copias stale. Warning añadido al top de este CLAUDE.md.

- **Phase 4.3 (Stellar Classic NFT collectible)** — Implemented 2026-05-03:
  - **Goal**: que cada boleto se vea como un coleccionable en Freighter del comprador, y que se transfiera al revenderlo P2P.
  - **DB**: nueva columna `tickets.asset_code` (TEXT, unique) — script `backend/scripts/add-asset-code-column.ts`. Formato: `T` + 11 hex del UUID en uppercase (alphanum12 válido).
  - **Issuer setup**: `backend/scripts/setup-issuer-flags.ts` activa `AUTH_REVOCABLE` + `AUTH_CLAWBACK_ENABLED` en la wallet del organizer. Necesario para clawback en reventa sin firma del vendedor.
  - **Mint en `/secure-ticket`**: tras `crear_boleto_para`, backend genera asset_code, lo persiste y devuelve `trustXdr` (CHANGE_TRUST limit=1). Frontend pide a Freighter firmar el trust → submit a Horizon (`/api/transactions/submit-classic`) → llama `/api/transactions/mint-collectible` que firma server-side el PAYMENT 1 unidad (issuer = organizer). Idempotente: si la wallet ya tiene la unidad, devuelve `alreadyMinted: true`.
  - **Transfer en reventa P2P**: `live_tickets` ahora incluye `assetCode`. `buyResaleTicket(contractAddress, ticketRootId, buyerPk, assetCode?)` orquesta: (1) trust del comprador vía `/build-trust-xdr` + Freighter + `submit-classic`, (2) firma + submit del Soroban `comprar_boleto`, (3) tras 7s espera de indexer, llama `/api/transactions/transfer-collectible` que hace clawback al vendedor + payment al comprador en una sola tx Horizon firmada por el organizer.
  - **Endpoints nuevos**: `POST /mint-collectible`, `POST /transfer-collectible`, `POST /build-trust-xdr`, `POST /submit-classic`. Importante: `submit-classic` usa Horizon (no Soroban RPC) porque las ops clásicas no pasan por sorobanRpc.
  - **Trade-offs documentados**:
    - Cada coleccionable cuesta **0.5 XLM de reserva permanente** en la wallet del comprador (estándar trustline). Para 11 eventos/usuario eso son ~5.5 XLM bloqueados.
    - El coleccionable **NO se quema al redimir** el boleto (en `boleto_redimido`). Se queda en la wallet como recuerdo. Si en el futuro se quiere quemar, agregar clawback en el indexer.
    - El mint+trust requieren **2 firmas adicionales** del comprador (CHANGE_TRUST en mint y CHANGE_TRUST en cada compra de reventa). Es UX peor pero necesaria del modelo Stellar Classic.
    - Si el mint del coleccionable falla, el ticket queda igualmente asegurado en Soroban (degradación graceful, no fatal).
  - **Variables de entorno**: opcional `HORIZON_URL` (default `https://horizon-testnet.stellar.org`).

### Pending — NEXT SESSION START HERE
- **Phase 5** — Thesis documentation: **updated DB diagram** (new `resale_price` + `asset_code` columns, STAFF role, seat inventory tables), updated architecture diagrams, Web2 problem mitigation analysis, test evidence screenshots, latency/cost metrics (Stroops)

### Key architectural rules
- Backend signs `crear_boleto`, `listar_boleto`, and `cancelar_venta` server-side with organizer key. For buyer-facing operations (`comprar_boleto`), backend builds unsigned XDR and frontend signs with **Freighter wallet**
- `ORGANIZER_SECRET` env var required for on-chain ticket creation, listing, and cancel
- `FACTORY_CONTRACT_ID` env var required for Admin Dashboard contracts panel
- **Freighter v6 API** returns objects, not primitives (e.g., `{ isConnected: bool }`, `{ address: string }`, `{ signedTxXdr: string }`). ConnectWallet only renders when logged in, auto-links wallet to backend, handles duplicate wallet (409). Other components should NOT call Freighter directly
- **Wallet identity**: `owner_wallet` on tickets must be user's `wallet_address` (not organizer key). `toUserDto` returns `walletAddress` so frontend loads it on login. This enables seller detection in EventDetail P2P section
- **Indexer** keeps PostgreSQL in sync with on-chain state (polls Soroban events every 5s, 7 event handlers). P2P sales (both `boleto_comprado_primario` with `resale_price` and `boleto_revendido`) cancel old ticket + create new with `order_item_id` preserved
- Web2 purchase flow (cart -> checkout -> order) remains intact; blockchain is an **opt-in layer** on top
- `payments.provider_reference` stores blockchain transaction hashes
- `tickets` table uses `(contract_address, ticket_root_id, version)` unique constraint to mirror on-chain state
- Frontend seller detection: if `walletAddress === sellerWallet`, show "Cancelar Reventa" instead of "Comprar"
- **DB schema changes** are applied via `backend/scripts/migrate-tickets.ts` (not prisma migrate), must be run manually
- **Backend cache**: In-memory Map with TTL for event queries. `invalidateCache(prefix?)` to clear. Live ticket data (resale) is never cached
- **XLM/COP price**: Frontend hook `useXlmPrice` fetches from CoinGecko, cached 5min in localStorage. Used in ConnectWallet, MySalesP2P, EventDetail. Purely informational — all on-chain values remain in XLM/stroops
- **Connection pool**: `connection_limit=5` in DATABASE_URL (Supabase pgbouncer). Must be >1 to avoid timeouts when indexer + API run concurrently
- **Role-based access**: `user_role` has CUSTOMER/ADMIN/STAFF. Admin endpoints check role server-side (no JWT claim — always re-query DB). Frontend gates via `user?.role` from AppContext. STAFF can scan tickets; ADMIN can also manage events and see contracts panel.
- **Scan is intentionally DB-only**: On-chain `redimir_boleto` would require organizer key + Soroban RPC round-trip (~5s). The thesis demo scans at gate speed by just updating PostgreSQL. This is a documented trade-off, not a bug.
- **Serverless-aware**: Si `VERCEL=1`, el backend NO llama `app.listen()` ni arranca el indexer. Exporta `app` como default para el handler de Vercel (`backend/api/index.ts`). El indexer solo corre en Railway/Render/local.
- **Cart ownership enforced**: `PATCH/DELETE /api/cart/items/:id` usan `updateMany`/`deleteMany` con filtro `user_id` — un usuario no puede modificar items del carrito de otro.
