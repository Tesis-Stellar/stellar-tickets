# CLAUDE.md

Guidance for Claude Code working in this repository.

> ⚠️ **PATHS — read first.** Código activo: `D:\Tesis\Codigo\main_contract\backend` y `\frontend`. **NO** trabajar en `D:\Tesis\backend\` ni `D:\Tesis\frontend\` (copias stale; no afectan al backend en `localhost:3000` ni al Vite dev server).

## Repository Layout

- `codigo/main_contract/` — Monorepo: contracts + backend + frontend
- `documentos/Documento_Tesis/` — Tesis LaTeX + diagramas

```
codigo/main_contract/
├── contracts/           # Rust/Soroban (Cargo workspace)
├── backend/             # Express + Prisma + Indexer
├── frontend/            # React Vite + Tailwind + shadcn/ui + Freighter
├── docs/                # Architecture & technical docs
├── .github/workflows/   # CI for Soroban contracts
└── README.md
```

**Architecture: Web2.5 Hybrid** — Web2 UX (catálogo, auth, cart) + Web3 ownership (Freighter signing, Soroban, burn/remint). Backend es **stateless XDR proxy** (no guarda llaves privadas). Frontend firma con Freighter.

---

## Smart Contracts (Soroban / Stellar)

**Root:** `contracts/`. Cargo workspace, `soroban-sdk = "23"`. Release: opt-level="z", LTO, stripped, panic="abort".

```
contracts/contracts/
├── event_contract/src/{lib.rs ~1142, test.rs ~709, 35+ tests}
└── factory_contract/src/{lib.rs ~431, test.rs ~245, 13 tests}
```

**Commands:** `stellar contract build` · `cargo test [<name>]` · `cargo fmt --all`

### event_contract — Gestión de boletos

Contrato por evento: ciclo de vida completo (venta primaria, reventa atómica burn/remint, verificación en puerta). **Todo el código en español**.

**Struct `Boleto`:** `ticket_root_id`, `version`, `id_evento`, `propietario` (Address), `precio` (i128), `en_venta`, `es_reventa`, `usado`, `invalidado`

**Storage (`ClaveDato`):** `Boleto(u32,u32)`, `VersionActual(u32)`, `ContadorBoletos`, `Organizador`, `Plataforma`, `TokenPago`, `ComisionOrganizador`, `ComisionPlataforma`, `Verificador(Address)`

**Funciones públicas:**
- `inicializar(organizador, plataforma, token_pago, comision_org, comision_plat)` — setup único
- `crear_boleto(id_evento, precio) -> u32` (ticket_root_id)
- `listar_boleto(ticket_root_id, nuevo_precio)` / `cancelar_venta(ticket_root_id)`
- `comprar_boleto(ticket_root_id, comprador) -> u32` — Dos flujos:
  - **Primaria** (`es_reventa=false`): 100% organizador, update in-place, marca `es_reventa=true`
  - **Reventa** (`es_reventa=true`): comisiones (org+plat+vendedor), burn vieja + remint nueva versión
- `agregar_verificador / remover_verificador / es_verificador(address)`
- `redimir_boleto(ticket_root_id, verificador)` — solo verificadores autorizados
- `invalidar_boleto(ticket_root_id)` — cancelación admin
- Consultas: `obtener_boleto`, `obtener_boleto_version`, `obtener_version_vigente`, `obtener_propietario`, `obtener_boletos_reventa` (O(n)), `obtener_boletos_evento` (O(n))

**Errores (`ErrorContrato`, u32):** 1=YaInicializado, 2=ComisionesMuyAltas, 3=ComisionesNegativas, 4=PrecioInvalido, 5=YaEnVenta, 6=BoletoUsado, 7=NoEnVenta, 8=AutoCompra, 9=YaUsado, 10=BoletoNoEncontrado, 11=NoAutorizado, 12=VersionInvalida, 13=BoletoInvalidado, 14=NoInicializado, 15=VerificadorYaExiste, 16=VerificadorNoEncontrado

**Eventos on-chain:** BoletoCreado, BoletoListado, VentaCancelada, BoletoCompradoPrimario, BoletoRevendido, BoletoRedimido, BoletoInvalidadoEvt, VerificadorAgregado, VerificadorRemovido

**Reglas:** Primaria 100% organizador (sin plataforma); reventa = comisiones + burn/remint; `es_reventa` se marca tras 1ª compra (no al listar); usados/invalidados no se mueven; solo verificadores redimen; `BASE_PORCENTAJE=100` (i128); `require_auth()` en todo state change.

### factory_contract — Fábrica

Patrón Factory: deploy de un event_contract independiente por evento.

**Struct `ConfiguracionEvento`:** `id_evento`, `organizador`, `token_pago`, `comision_organizador` (u32), `comision_plataforma` (u32), `wallet_organizador`, `wallet_plataforma`, `capacidad_total`

**Storage:** `Administrador`, `ContadorEventos`, `HashWasmEvento`, `ContratoEvento(u32)`, `ContratoRegistrado(Address)`

**Funciones:** `inicializar(admin)` · `configurar_wasm_evento(BytesN<32>)` · `crear_evento_contrato(config, direccion_prueba) -> Address` (doble auth admin+organizador) · `obtener_contrato_evento(id)` · `obtener_contador_eventos()` · `obtener_wasm_evento()`

**Deploy:** `#[cfg(test)]` usa direccion pre-registrada; producción usa `deployer().with_current_contract(salt).deploy_v2(hash, ())`. Salt = id_evento BE (4 bytes) + zeros. **Evento:** `EventoCreado(id, organizador, contrato, capacidad)`.

**Auth:** `require_auth()` en todo state change. event_contract: organizador (init/crear/verificadores/invalidar), propietario (listar/cancelar), comprador (comprar), verificador (redimir). factory: admin (init/wasm/crear) + organizador (co-sign crear).

---

## Backend (Express + Prisma + Indexer)

**Root:** `backend/`. **Stack:** Node + Express + TypeScript + Prisma + PostgreSQL (Supabase) + Stellar SDK. **Status: FUNCTIONAL** (compila, conecta a Supabase, auth real bcrypt+JWT, integración Soroban completa, indexer en background).

**Commands:** `npm install` · `npx prisma generate` · `npm run dev` (tsx watch) · `npm run build` · `npm start`

**Files:** `src/server.ts` (API + auth + checkout + Soroban), `src/indexer.ts` (poller Soroban), `prisma/schema.prisma`, `tsconfig.json` (ES2021/commonjs). **Env:** DATABASE_URL, SOROBAN_RPC_URL, PORT, JWT_SECRET, ORGANIZER_SECRET, FACTORY_CONTRACT_ID, HORIZON_URL (opt). **Deps:** express, @prisma/client, @stellar/stellar-sdk, cors, dotenv, bcryptjs, jsonwebtoken.

### API Endpoints

**Públicos (DTO matching frontend `EventListItemDto`):**
- `GET /` (root texto plano), `GET /health`
- `GET /api/events` — PUBLISHED (transformed: category, city, venue, organizer, minPrice, startsAt). Cached 60s.
- `GET /api/events/featured` — Top 6. Cached 60s.
- `GET /api/events/:slug` — detalle + `live_tickets` (is_for_sale=true) + `ticketTypes` (formatted, evita extra call). Cached 30s.
- `GET /api/events/:id/ticket-types`, `GET /api/events/:id/related` (max 4, cached 60s)

**Soroban (auth required):**
- `POST /api/transactions/buy` — XDR builder unsigned
- `POST /api/transactions/secure-ticket` — `crear_boleto` (organizer-signed); actualiza DB con `contract_address`, `ticket_root_id`, `version`, `owner_wallet` (user, no organizer); genera `asset_code` y devuelve `trustXdr`. Returns `{txHash, contractAddress, ticketRootId, trustXdr, assetCode}`.
- `POST /api/transactions/list-ticket` — `listar_boleto` (org-signed). Body `{ticketId, price}` (stroops). DB: `is_for_sale=true`, `resale_price`, `owner_wallet`.
- `POST /api/transactions/cancel-listing` — `cancelar_venta` (org-signed). Body `{ticketId}`. DB: `is_for_sale=false`, `resale_price=null`.
- `POST /api/transactions/build-buy-xdr` — XDR unsigned para `comprar_boleto` con buyer como source. User-friendly error en saldo insuficiente.
- `POST /api/transactions/submit` — recibe XDR firmado por Freighter, submit a Soroban RPC, polls. Returns `{success, txHash}`.
- `POST /api/transactions/mint-collectible` — PAYMENT 1 unidad (issuer=organizer). Idempotente (`alreadyMinted:true` si ya existe).
- `POST /api/transactions/transfer-collectible` — clawback al vendedor + payment al comprador en una tx Horizon firmada por organizer.
- `POST /api/transactions/build-trust-xdr` — CHANGE_TRUST limit=1 para asset_code.
- `POST /api/transactions/submit-classic` — submit XDR clásico vía Horizon (NO Soroban RPC; ops clásicas no van por sorobanRpc).

**Auth (bcrypt + JWT):**
- `POST /api/auth/login` — bcrypt.compare → JWT 7d + DTO
- `POST /api/auth/register` — bcrypt.hash(10), 409 duplicado
- `GET /api/users/me` (authMiddleware), `PATCH /api/users/me` (firstName, lastName, phone, documentType, documentNumber)
- `PATCH /api/users/me/wallet` — link Freighter
- `authMiddleware` extrae userId del JWT → `req.userId` (401 si missing/invalid)

**Cart (auth):** `GET /api/cart` · `POST /api/cart/items {ticketTypeId, quantity}` (auto-crea cart; check constraint: solo GA = sin venue_section_id) · `PATCH/DELETE /api/cart/items/:id` (filtro user_id, no cross-user) · `DELETE /api/cart/clear`

**Checkout (auth):**
- `POST /api/checkout/preview` → `{subtotal, serviceFees, total, itemCount}`
- `POST /api/checkout/confirm` — atómico: orders + order_items + tickets + payments; cart→CONVERTED; payment simulado PAID. Returns `{id, orderNumber, subtotal, serviceFees, total}`.

**Orders & tickets (auth):**
- `GET /api/orders` — historial
- `GET /api/tickets` — activos + Web3 fields (`isSecuredOnChain`, `contractAddress`, `ticketRootId`, `version`, `ownerWallet`, `assetCode`)
- `GET /api/tickets/sold` — tickets vendidos P2P (CANCELLED + resale_price≠null); incluye `buyerWallet` (lookup en next version del mismo ticket_root_id), `resalePrice` (stroops)

**Admin (ADMIN role):**
- `GET /api/admin/venues` (con sections), `GET /api/admin/events` (todos, no solo PUBLISHED)
- `POST /api/admin/events` — crea + auto event_ticket_types + invalida cache
- `POST /api/admin/events/:id/deploy` — corre deploy script, actualiza `contract_address`
- `GET /api/admin/contracts` — `{factoryContractId (env), events[]}`
- `POST /api/admin/scan` — **ADMIN o STAFF**: `{ticketId}` → CANCELLED en DB. **DB-only** (sin `redimir_boleto` on-chain) para velocidad de puerta.

**Cache:** helper `cached(key, ttlMs, fn)` (Map en memoria); `invalidateCache(prefix?)`. Live tickets NO cacheados. `connection_limit=5` en DATABASE_URL (era 1, causaba pool timeouts).

### Indexer

Polls Soroban RPC c/5s. Procesa eventos de todos los contratos con `contract_address`:

| Evento (snake_case) | Acción DB |
|---|---|
| `boleto_creado` | Crea ticket si no existe |
| `boleto_listado` | `is_for_sale=true` |
| `venta_cancelada` | `is_for_sale=false` |
| `boleto_comprado_primario` | Si tiene `resale_price` (P2P): cancel seller + crea buyer (version+1, copia `order_item_id`). Else: update owner in-place |
| `boleto_revendido` | Cancel old (preserva `resale_price`), crea new version (copia `order_item_id`). **Idempotente** (check existence pre-create para evitar P2002) |
| `boleto_redimido` | status=USED |
| `boleto_invalidado_evt` | status=CANCELLED |

- Cursor en `indexer_state.last_ledger`; primer run = 100 ledgers atrás
- Chunks: 1000 ledgers/req, 5 contract IDs/filter (límite RPC)
- **Auto-recovery ledger range**: parsea `parseRpcLedgerRangeError`, ajusta cursor al min/max permitido (RPC público solo retiene recientes)
- **Solo en long-lived**: si `VERCEL=1` no arranca (serverless no soporta procesos fondo)
- Reintenta tras 5s en error

### Known limitations

1. **Org-signed**: `crear_boleto`, `listar_boleto`, `cancelar_venta` firmados server-side. `comprar_boleto` por buyer vía Freighter.
2. **Seated events resueltos**: todos GA via `fix-seated-events.ts` (luego restaurados a seated en Phase 4.1).
3. **Imágenes hardcoded**: sin columna DB; mapeo por slug en `EVENT_IMAGES` (Unsplash) + fallback `CATEGORY_IMAGES`.
4. **node_modules workaround**: `plain-crypto-js` lock en Windows. Usar `npx --yes yarn install && npx prisma generate`.
5. **Una Freighter wallet/browser**: si linkeada a user A, user B en mismo browser → 409. Usar incognito o cambiar Freighter.
6. **Scan DB-only**: `POST /api/admin/scan` no llama `redimir_boleto` on-chain (evita +5s en puerta).
7. **Render/Vercel**: prod usa `tsx src/server.ts`. `stellar-sdk` pin `14.4.1`. `tsconfig.json` `incremental:false`. Vercel via `backend/api/index.ts`.
8. **JWT_SECRET requerido en prod**: si `NODE_ENV=production` sin JWT_SECRET → throw al arrancar. Dev = warning + fallback inseguro.

### Database Schema (Prisma)

PostgreSQL schema `ticketing` en Supabase.

**Web3 fields:**
| Model | Fields |
|---|---|
| `users` | `wallet_address` (unique, opt) |
| `events` | `contract_address` (unique, nullable) |
| `tickets` | `contract_address`, `ticket_root_id`, `version`, `is_for_sale`, `resale_price` (BigInt stroops), `owner_wallet`, `asset_code` (unique). Unique: `(contract_address, ticket_root_id, version)` |
| `indexer_state` | `last_ledger` |

**NOTA:** `resale_price` y `asset_code` añadidos via scripts (`migrate-tickets.ts`, `add-asset-code-column.ts`), NO via prisma migrate. Diagrama tesis necesita update.

**Web2 models:** users (CUSTOMER/ADMIN/STAFF), events, organizers, venues, venue_sections, seats, event_ticket_types, event_seat_inventory (AVAILABLE/HELD/SOLD/BLOCKED), carts, cart_items, seat_holds (TTL), orders, order_items, payments (CARD/PSE/CASHPOINT), tickets (ACTIVE/USED/CANCELLED/REFUNDED), event_categories, cities

**Enums:** document_type (CC/CE/TI/PP), event_status, user_role (**CUSTOMER/ADMIN/STAFF** — STAFF en Phase 4), cart_status, order_status, payment_method, payment_status, seat_hold_status, seat_inventory_status, ticket_status, venue_type

---

## Frontend (React + Vite + Freighter)

**Root:** `frontend/`. **Stack:** React 18 + TS + Vite + Tailwind + shadcn/ui (Radix) + TanStack Query + Framer Motion. **Web3:** `@stellar/freighter-api` ^6.0.1, `@stellar/stellar-sdk` ^14.6.1.

**Commands:** `npm run dev` (:8080) · `build` · `test` (Vitest) · `lint`

### Routing (23)

`/`, `/eventos`, `/eventos/:category`, `/buscar`, `/evento/:id`, `/evento/:id/boletas`, `/evento/:id/asientos`, `/carrito`, `/checkout`, `/confirmacion`, `/login`, `/registro`, `/mi-cuenta`, `/mi-cuenta/entradas`, `/mi-cuenta/compras`, `/mi-cuenta/ventas-p2p`, `/mi-cuenta/perfil`, `/contactanos`, `/admin` (ADMIN), `/escanear` (ADMIN/STAFF), `*` (404)

### State & API (AppContext.tsx)

- React Context: cart, orders, purchasedTickets, soldTickets, user, JWT auth
- `apiFetch<T>(path, init?)` — Bearer token desde `localStorage.authToken`. **Expuesto en context** (admin/scanner pages).
- `VITE_API_BASE_URL` (def `http://localhost:3000`)
- Funciones API: auth, cart, checkout, orders, tickets, `secureTicketOnChain`, `listTicketForSale`, `cancelResaleListing`, `buyResaleTicket`, `linkWallet`
- `walletAddress`/`setWalletAddress` — shared. Cargada desde `/api/users/me` (returns `walletAddress`) Y desde Freighter on connect.
- `soldTickets: SoldTicket[]` — `GET /api/tickets/sold`. Tiene `buyerWallet`, `resalePrice`, event data.
- `refreshTickets()`/`refreshSoldTickets()` — re-fetch (7s delay tras `buyResaleTicket`).
- `balanceVersion` — counter post buy/list/cancel → ConnectWallet re-fetch XLM desde Horizon.
- `mapTicketsResponse()` — helper extraído (de-dup load + checkout).
- `ensureFreighterReady(expectedAddress?)` — llama `requestAccess()` si no autorizado; verifica match con wallet vinculada.
- `UserData.role`: `CUSTOMER|ADMIN|STAFF` (de `/api/users/me`). Usado en Header + admin pages.

### Key components

**Web3:**
- `ConnectWallet.tsx` — **solo si logged in**. Freighter v6 (objects: `{isConnected}`, `{address}`, `{signedTxXdr}`). Auto-link al backend (handle 409). Muestra XLM + COP (`useXlmPrice`). Refresh on `balanceVersion`. Lee `walletAddress` desde context (persistente entre navegaciones); solo invoca Freighter si no hay address en context.
- `TicketCard.tsx` — "Asegurar en Blockchain" → `secure-ticket` → badge + Stellar Explorer + trust+mint del coleccionable. "Revender NFT" → `<Dialog>` shadcn (precio en COP, preview XLM en vivo via `useXlmPrice`) → `list-ticket` → badge "En Venta" + "Cancelar Reventa". Wallet guard alert si sin Freighter.
- `EventDetail.tsx` — "Reventa P2P Segura" con precio XLM+COP. Si `walletAddress===sellerWallet` → "Cancelar Reventa". Else → "Comprar" → `buyResaleTicket(contractAddress, ticketRootId, buyerPk, assetCode?)` → trust + Soroban + transfer-collectible. Usa `ticketTypes` del detail (no extra call).

**Layout:** Header (nav + ConnectWallet + Admin/Scanner para ADMIN/STAFF), Footer, HeroSearch, CategorySection, AccountSidebar
**UI:** EventCard, TicketCard, TicketSelector, SeatMap (VIP/Platea/General), BannerCarousel, FilterPanel, PromoStrip, CheckoutStepper
**Hooks:** `useXlmPrice` — XLM/COP CoinGecko, cache 5min localStorage. Exports `useXlmPrice()`, `formatCOP()`, `stroopsToXLM()`.
**Pages:** Index, EventsList, EventDetail, TicketPurchase, SeatSelection, Cart, Checkout (3-step), Confirmation, Account, MyTickets, MySalesP2P, PurchaseHistory, Profile, Login, Register, Contact, SearchResults, NotFound, **AdminDashboard**, **ScannerPage**

### Data fetching (src/data/events.ts)

`getEvents(filters?)`, `getFeaturedEvents()`, `getEventBySlug(slug)` (usa `ticketTypes` del detail), `getEventById(id)`, `getRelatedEvents(eventId)`, `getEventTicketTypes(eventId)`. Maps a `EventData` (fechas español, COP). Static banner.

---

## Documentation

`docs/` reorganizado 2026-04-20:
```
docs/
├── README.md
├── architecture/    # ARCHITECTURE.md (Mermaid), CONTRACTS_TECHNICAL_REFERENCE.md, EVENTOS_ON_CHAIN.md, MODELO_DATOS.md, ADMIN_OFFCHAIN_SIMULATION_SPEC.md
├── archive/         # CLAUDE.md prev, HANDOVER_AI.md, QUICK_REFERENCE.md, ...
├── audits/          # BACKEND_AUDIT.md, CONTRACTS_AUDIT.md, FRONTEND_AUDIT.md
├── backlog/         # PROJECT_, BACKEND_, CONTRACTS_, FRONTEND_BACKLOG.md
├── operations/      # DEVELOPMENT_WORKFLOW.md, TESTNET_DEPLOYMENTS.md, WALLETS_ROLES_TESTNET.md
└── setup/           # ONBOARDING.md, DOCKER_CLI_WORKFLOW.md, UPDATE_POLICY.md
```

**Tooling `tooling/`:** `bootstrap-check.sh`, `health-check.sh`, `contracts-docker.sh`, `docker/stellar-contracts.Dockerfile` (build sin Rust local).

**Tesis `documentos/Documento_Tesis/`:** `Memoria/` (`main.tex` + chapters), `diagramas/` (Mermaid), `SRS/`, `Plan_de_proyecto/`, `Propuesta_TG/`.

### CI

`.github/workflows/soroban.yml` — push/PR a main. `cargo-binstall` para `stellar-cli`, build per-package (`--package`) para evitar colisión símbolos en `wasm32v1-none`. `cargo test`, sube WASM.

**Vercel:** `frontend/vercel.json` + `backend/vercel.json`. Backend via `backend/api/index.ts` (re-export). Frontend SPA rewrites.
**DevContainer:** `.devcontainer/` Dockerfile + postCreate.sh.

### Testnet Deployment

**Script:** `backend/scripts/deploy-contracts.ts`. Flow: keypairs → friendbot → upload WASM → deploy 1 contrato/evento → `inicializar()` → DB `contract_address`.

- WASM hash: `32fbb9bf4e7f803c1e5caf3c2744e1efedb51975fd2775ebdfe1475e999bb0ef`
- XLM nativo: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- Comisiones: 5% org, 3% plat (i128). Organizer = source de `inicializar` (require_auth).
- Keypairs en `backend/.env.deploy` (gitignored). 11/11 desplegados (2026-03-31), redesplegados con WASM nuevo + wallets rotadas (Phase 4.1).

---

## Web2.5 Integration Roadmap

### Completed

- **Phase 1** — Smart contracts: burn/remint, errores tipados, rol verificador, factory deploy, 48+ tests, CI.
- **Phase 2** — Backend funcional: Express + Prisma + Indexer compilando y corriendo, conectado a Supabase (11 events, 26 users). package.json creado, TS errors fixed, BigInt serialization fixed.
- **Phase 3 (partial)** — Frontend: e-commerce completo (browse/cart/checkout/account), Freighter deps, ConnectWallet, botones Web3 simulados. Build OK (7 lint warnings).
- **Phase 3.5** — Wired: backend devuelve DTO matching frontend `EventListItemDto`. Endpoints `/featured`, `/ticket-types`, `/related`. Eventos Supabase visibles en UI.
- **Phase 3.6 (auth)** (2026-03-30) — Real auth: bcryptjs + jsonwebtoken reemplazan mocks. Login verifica `password_hash`, register hash bcrypt(10), `/users/me` protegido por JWT middleware. Deps via yarn workaround. TS clean, server arranca.
- **Phase 3.6 (checkout)** (2026-03-31) — Checkout fiat completo: cart CRUD persistido (carts + cart_items), checkout crea orders + order_items + tickets + payments atómico, cart→CONVERTED. Orders/tickets endpoints reales. Fixes: Checkout `Field` extraído (focus loss), TicketCard venue object render. Tested e2e (GA).
- **Phase 3.6 (deploy)** (2026-03-31) — 11 contratos Soroban en testnet: CI fixed (cargo-binstall, wasm32v1-none, per-package), deploy script debugged (i128 comisiones, organizer source para require_auth). Eventos en DB con `contract_address`.
- **Phase 3.6.1 (secure on-chain)** (2026-03-31) — "Asegurar en Blockchain" e2e: backend `/secure-ticket` llama `crear_boleto` (org-signed), DB con on-chain data. Frontend badge real + Stellar Explorer link. Indexer fixed para 11 contratos (5/filter chunking). Verificado en testnet.
- **Phase 3.7 (secondary market)** (2026-03-31) — Marketplace reventa e2e en testnet. Backend: `/list-ticket` (org-signed `listar_boleto`), `/build-buy-xdr` (unsigned `comprar_boleto`), `/submit` (signed XDR), `/users/me/wallet` (link Freighter). Frontend: ConnectWallet rewrite Freighter v6 (objects, no primitives), `walletAddress` en AppContext, TicketCard "Revender NFT" real, EventDetail "Reventa P2P Segura" con marketplace + Freighter purchases, self-purchase prevention. Indexer con 7 handlers snake_case. Tested: tx `3f93a54c3a66...`.
- **Phase 3.8 (resale UX polish)** (2026-04-02):
  - **Wallet-user binding**: ConnectWallet solo si logged in, auto-link al backend, handle 409 dup. `walletAddress` desde user profile (no solo Freighter) → seller detection sin extension.
  - **Cancel listing**: `/cancel-listing` llama `cancelar_venta`. `cancelResaleListing` en context. Botón en TicketCard + EventDetail.
  - **Resale price**: columna `resale_price` (BigInt stroops). Set on list, clear on cancel. EventDetail muestra XLM.
  - **Post-checkout refresh**: tras confirm, fetch real tickets de `/tickets` para DB UUIDs reales (fix UUID parse error).
  - **owner_wallet fix**: `secure-ticket`/`list-ticket` guardan user wallet (no organizer key). `migrate-tickets.ts` arregla existentes.
  - **Imagenes Mis Entradas**: fix mapping `posterImage` → `image`.
  - **Register form focus**: `Field` extraído fuera de `Register` (re-mount cada keystroke).
  - **Buy errors**: `build-buy-xdr` detecta saldo insuficiente, mensaje user-friendly.
  - **DB migration**: `resale_price BIGINT` añadido manualmente via script.
- **Phase 3.9 (P2P sales, COP balance, performance)** (2026-04-03):
  - **Mis Ventas P2P** (`/mi-cuenta/ventas-p2p`): completed P2P sales con buyer wallet, evento, monto XLM+COP, summary card. AccountSidebar+Account.
  - **XLM/COP**: `useXlmPrice` hook (CoinGecko, cache 5min localStorage). En ConnectWallet, MySalesP2P, EventDetail.
  - **`/tickets/sold`**: tickets CANCELLED + resale_price≠null. Lookup `buyerWallet` desde next version.
  - **Indexer fix P2P primary**: `boleto_comprado_primario` con `resale_price` cancela seller + crea buyer (como `boleto_revendido`); antes solo update in-place sin record de venta.
  - **Indexer preserva `order_item_id`**: ambos handlers P2P copian al new ticket → event linkage para buyer.
  - **Auto-refresh post-purchase**: callbacks reusables, 7s delay (indexer polling). `balanceVersion` → ConnectWallet refresh.
  - **Cache backend**: `cached(key, ttlMs, fn)` (events 60s, featured 60s, detail 30s, related 60s; live tickets NO). Reduce Supabase RTT (~150ms desde Colombia a US West).
  - **Detail incluye ticketTypes**: `/events/:slug` formatted, elimina extra call.
  - **Connection pool**: `connection_limit=5` (era 1) → no Prisma timeouts con indexer + API concurrentes.
  - **AppContext refactor**: `mapTicketsResponse()` helper, `refreshTickets()` callback.
- **Phase 4 (admin panel + scanner)** (2026-04-04):
  - **Admin Dashboard** (`/admin`, ADMIN): events con contract status, venues+sections, contracts panel (factory ID + Stellar Expert links). Crear eventos con venue/section + precio. "Deploy to Soroban" corre `deploy-contracts.ts` server-side.
  - **QR Scanner** (`/escanear`, ADMIN+STAFF): `@yudiel/react-qr-scanner` (npm). QR `{ticketId: uuid}` → `/admin/scan` → CANCELLED en DB. Visual success/error. **DB-only** (sin on-chain) por velocidad.
  - **STAFF role**: añadido al enum `user_role`. STAFF accede Scanner pero no Admin.
  - **Header**: links Admin (amber) + Escáner (green) para ADMIN/STAFF.
  - **`apiFetch` expuesto**: en AppState interface, admin/scanner pages usan context.
  - **Wallet guard TicketCard**: alert si "Asegurar"/"Revender" sin Freighter.
  - **GA conversion**: `fix-seated-events.ts` → 6 seated→GA, todos 11 eventos comprables.
  - **Cleanup script**: `clean-users.ts` resetea users para demo.
  - **Render fixes**: `stellar-sdk` pin `14.4.1`, start `tsx src/server.ts` (no JS compilado), `tsconfig.json` `incremental:false`.
- **Phase 4.1 (seated events + wallet rotation + UX polish)** (2026-05-02):
  - **Seat-based restored**: post-refactor `GET /api/events/:id/seats` daba 400. Fix: `seed-seat-inventory.ts` (idempotente) crea 3 secciones/venue (VIP 2×10, Platea 3×12, General 4×14), seats numerados, `event_seat_inventory` AVAILABLE, ticket_types atados a sección con `inventory_quantity=null`. Sets `events.has_assigned_seating=true`.
  - **Cart trigger fix**: `validate_cart_item_consistency` rechazaba seat-based (exigía `inventory_quantity NOT NULL`). `fix-cart-trigger.ts` añade guard `AND NEW.event_seat_inventory_id IS NULL` (solo valida quantity-based para GA).
  - **set_updated_at restoration**: función sobrescrita accidentalmente con lógica del cart trigger → `column "new" does not exist` en cualquier UPDATE. `restore-set-updated-at.ts` la regresa a `NEW.updated_at = NOW()`.
  - **DTOs seat-based fallback**: `cart_items`/`order_items`/`tickets` seat-based solo guardan `event_seat_inventory_id` (NO `event_ticket_type_id`) por CHECK constraint `chk_*_one_source`. Endpoints `GET /cart`, `/tickets`, `/secure-ticket`, `/tickets/sold` resuelven `ticketType`+`event` via `event_seat_inventory.event_ticket_types.events` cuando join directo es null.
  - **Wallet rotation**: wallets demo rotadas, set con 12 palabras documentadas en `.env.deploy` (ADMIN, ORGANIZER, PLATFORM, BUYER1, BUYER2, VERIFIER). Nombres claros para trazabilidad tesis.
  - **Recompile + redeploy**: WASM en `contracts/wasm/event_contract.wasm` era 31-mar (pre commit 9361285) y NO tenía `crear_boleto_para` que llama el backend. Recompilado con `cargo build --release --target wasm32v1-none` (Soroban-compat; `wasm32-unknown-unknown` genera reference-types rechazadas). 12 contratos redesplegados con WASM nuevo + nuevas wallets.
  - **Deploy script refactor**: NO genera keypairs aleatorios (carga de `.env.deploy`); salt aleatorio/contrato (evita `ExistingValue` al redesplegar con mismo admin); WASM_DIR → `contracts/wasm/` (versionada); pre-deploy limpia `contract_address=null` en PUBLISHED para forzar redeploy.
  - **UI: precio reventa COP**: `TicketCard.tsx` reemplaza `prompt()` con `<Dialog>` shadcn. User ingresa COP, preview XLM en vivo (`useXlmPrice`) + cotización. Backend sigue recibiendo XLM/stroops (conversión solo UI).
  - **ConnectWallet persistente**: cada page renderiza su `<Header />` → remount + "Connect Wallet" 300-500ms al navegar. Refactor: lee `walletAddress` desde AppContext (persistente). Solo invoca Freighter si no hay address. Wallet visible al navegar y al recargar (gracias a `/users/me` → `walletAddress`).
  - **Critical paths**: warning sobre `D:\Tesis\backend\` y `D:\Tesis\frontend\` stale añadido al top.
- **Phase 4.3 (Stellar Classic NFT collectible)** (2026-05-03):
  - **Goal**: cada boleto = coleccionable visible en Freighter del comprador, transferido en reventa P2P.
  - **DB**: `tickets.asset_code` (TEXT unique) — `add-asset-code-column.ts`. Formato `T` + 11 hex UUID upper (alphanum12 válido).
  - **Issuer setup**: `setup-issuer-flags.ts` activa `AUTH_REVOCABLE` + `AUTH_CLAWBACK_ENABLED` en organizer (necesario para clawback en reventa sin firma vendedor).
  - **Mint en `/secure-ticket`**: tras `crear_boleto_para`, backend genera asset_code, persiste, devuelve `trustXdr` (CHANGE_TRUST limit=1). Frontend: Freighter firma trust → `/submit-classic` (Horizon) → `/mint-collectible` firma server-side PAYMENT 1 unit (issuer=organizer). Idempotente (`alreadyMinted:true`).
  - **Transfer en reventa**: `live_tickets` incluye `assetCode`. `buyResaleTicket(contractAddr, ticketRootId, buyerPk, assetCode?)`: (1) trust comprador via `/build-trust-xdr` + Freighter + `/submit-classic`, (2) firma + submit Soroban `comprar_boleto`, (3) +7s espera indexer → `/transfer-collectible` (clawback vendedor + payment comprador en 1 tx Horizon firmada por organizer).
  - **Endpoints**: `/mint-collectible`, `/transfer-collectible`, `/build-trust-xdr`, `/submit-classic`. **`submit-classic` usa Horizon** (no Soroban RPC; ops clásicas no van por sorobanRpc).
  - **Trade-offs**:
    - **0.5 XLM reserva permanente** por trustline en wallet comprador. 11 eventos = ~5.5 XLM bloqueados.
    - Coleccionable **NO se quema al redimir** (`boleto_redimido`). Queda como recuerdo. Para quemar, añadir clawback en indexer.
    - Mint+trust = **2 firmas adicionales** comprador (CHANGE_TRUST en mint y en cada reventa). Peor UX pero requerido por modelo Classic.
    - Si mint falla, ticket sigue asegurado en Soroban (degradación graceful).
  - **Env**: opcional `HORIZON_URL` (def `https://horizon-testnet.stellar.org`).

### Pending — NEXT SESSION START HERE
- **Phase 5** — Tesis: **diagrama DB actualizado** (nuevas columnas `resale_price` + `asset_code`, rol STAFF, tablas seat inventory), diagramas arquitectura, análisis mitigación problemas Web2, screenshots evidencia, métricas latencia/costo (Stroops).

### Key architectural rules

- Backend firma `crear_boleto`, `listar_boleto`, `cancelar_venta` (org key). Para `comprar_boleto` builds XDR unsigned, frontend firma con **Freighter**.
- `ORGANIZER_SECRET` requerido para crear/listar/cancelar on-chain. `FACTORY_CONTRACT_ID` para Admin contracts panel.
- **Freighter v6** devuelve objects (`{isConnected}`, `{address}`, `{signedTxXdr}`). ConnectWallet solo si logged in, auto-link, handle 409. Otros componentes NO llaman Freighter directamente.
- **Wallet identity**: `owner_wallet` = user `wallet_address` (no organizer). `toUserDto` devuelve `walletAddress` → frontend lo carga on login → seller detection en EventDetail P2P.
- **Indexer** sync PG↔on-chain (5s, 7 handlers). P2P sales (ambos `boleto_comprado_primario` con `resale_price` y `boleto_revendido`) cancel old + create new con `order_item_id` preservado.
- Web2 flow (cart→checkout→order) intacto; blockchain es **opt-in layer** encima.
- `payments.provider_reference` = blockchain tx hash. `tickets` unique `(contract_address, ticket_root_id, version)` espeja on-chain.
- Frontend seller detection: `walletAddress===sellerWallet` → "Cancelar Reventa" en vez de "Comprar".
- **DB schema changes** via `migrate-tickets.ts` y similares (no prisma migrate); manual.
- **Cache backend**: Map TTL para event queries. `invalidateCache(prefix?)`. Live ticket data NO cacheado.
- **XLM/COP**: `useXlmPrice` (CoinGecko, 5min localStorage). En ConnectWallet, MySalesP2P, EventDetail. Solo informativo — on-chain en XLM/stroops.
- **Connection pool**: `connection_limit=5` (Supabase pgbouncer). Debe ser >1 para indexer + API concurrentes.
- **Roles**: `user_role` CUSTOMER/ADMIN/STAFF. Endpoints admin chequean role server-side (no JWT claim — re-query DB). Frontend gates via `user?.role`. STAFF scan; ADMIN también events + contracts.
- **Scan DB-only** intencional: on-chain `redimir_boleto` requeriría organizer key + RPC RTT (~5s); demo escanea a velocidad de puerta solo updateando PG. Trade-off documentado, no bug.
- **Serverless-aware**: si `VERCEL=1`, backend NO `app.listen()` ni indexer. Exporta `app` default para handler Vercel (`backend/api/index.ts`). Indexer solo en Railway/Render/local.
- **Cart ownership**: `PATCH/DELETE /cart/items/:id` usan `updateMany`/`deleteMany` con filtro `user_id` — no cross-user.
