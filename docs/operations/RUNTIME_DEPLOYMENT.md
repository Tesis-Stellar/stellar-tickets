# Runtime Deployment

## Objetivo

Documentar el despliegue real del prototipo para evitar contradicciones entre SAD, SRS, demo y codigo. En la narrativa del producto, TuTicket es la ticketera demo y Secure Ticket es la capa/servicio Web2.5 de confianza que TuTicket consume para contratos, QR firmado, reventa controlada, evidencia y validacion operativa.

## Topologia Real

| Capa | Runtime actual | Rol |
| --- | --- | --- |
| Frontend TuTicket | Vite/React en Vercel o local | UI de ticketera, compra demo, cuenta de usuario y Freighter para clientes |
| Secure Ticket API | Node.js + Express en Railway o local long-lived | Auth, checkout simulado, scanner, XDR, submit, reglas P2P, evidencia y consola operativa |
| Base de datos | PostgreSQL/Supabase, schema `ticketing` | Proyeccion operativa, cache, ordenes, tickets, checkins |
| Blockchain | Stellar Testnet / Soroban | Contratos Secure Ticket, eventos on-chain y validaciones Web3 |
| Indexer | Proceso Node long-lived | Polling Soroban RPC, `onchain_events`, `indexer_state`, proyeccion DB |

## Backend Long-Lived

El backend principal debe ejecutarse como proceso persistente. En ese modo puede:

- escuchar HTTP con Express;
- compartir `DATABASE_URL` con Prisma;
- ejecutar o coordinar el indexador Soroban;
- mantener polling/reintentos sin depender del ciclo de vida de una funcion serverless.

En local:

```bash
cd backend
npm run dev
```

En Railway/Render o equivalente:

```text
Root Directory: backend
Start Command: npm start
```

## Limitacion Serverless

Serverless no es el runtime principal del backend porque:

- no garantiza procesos de fondo permanentes;
- puede cortar polling del indexador;
- complica reintentos largos contra Soroban RPC;
- puede ocultar inconsistencias si la API responde pero el indexer no esta activo.

El repo conserva `backend/api/index.ts` y `backend/vercel.json` como artefactos heredados/alternativos, pero la sustentacion debe explicar que el backend Web2.5 real corre como proceso long-lived.

## Indexer

El indexer sincroniza Soroban hacia PostgreSQL:

- lee eventos desde Stellar/Soroban RPC;
- guarda replay/idempotencia en `onchain_events`;
- actualiza cursor en `indexer_state`;
- proyecta cambios de version/estado en `tickets`;
- permite reconciliacion con `npm run reconcile:onchain-db`.

El indexer no reemplaza la verdad on-chain; PostgreSQL es la proyeccion operativa que permite UI y scanner.

## Configuracion Minima

Backend:

```env
DATABASE_URL=<postgresql-url-con-schema-ticketing>
JWT_SECRET=<secret-fuerte>
QR_SIGNING_SECRET=<secret-distinto>
CORS_ORIGINS=<frontend-url>
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
ORGANIZER_SECRET=<secret-key-custodial-del-backend>
ORGANIZER_PUBLIC=<public-key-organizador>
```

Frontend:

```env
VITE_API_BASE_URL=<backend-url>
```

## Smoke Check Operativo

```bash
cd backend
npx prisma migrate status
npm test
./node_modules/.bin/tsc --noEmit
npm run reconcile:onchain-db

cd ../frontend
npm test
npm run build
npm run lint:baseline
```

## Mensaje Para SAD/SRS

La documentacion final debe describir Secure Ticket como un prototipo Web2.5:

- Soroban aporta contratos, eventos, versionado y validaciones Web3.
- PostgreSQL/Supabase actua como proyeccion operativa/cache para UI, scanner y ordenes.
- El backend conserva responsabilidades centralizadas controladas, incluido `ORGANIZER_SECRET`, declaradas como limitacion academica.
- El indexer requiere ejecucion long-lived; serverless se considera alternativa limitada, no el runtime principal.
