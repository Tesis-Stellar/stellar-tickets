# Alcance y limitaciones de pruebas

Este documento delimita que queda cubierto por automatizacion reproducible y que se conserva como evidencia manual o limitacion academica.

## Automatizado

| Capa | Evidencia |
| --- | --- |
| Backend unitario | `npm run test:unit` valida policies de QR, scanner, reventa, seguridad, wallet, intents, migraciones y proyecciones. |
| Backend API/integracion | `npm run test:api` usa `DATABASE_URL_TEST` si existe y cubre Supertest + procesamiento de indexador contra PostgreSQL. |
| Frontend unitario | `npm test` cubre scanner, PQR, checkout, wallet por rol y errores de reventa. |
| E2E mock | `npm run e2e` valida la experiencia de demo con API interceptada. |
| E2E real | `npm run e2e:real` levanta backend local, siembra PostgreSQL, compra un ticket real y ejecuta scanner DB-first. |
| Carga | `load-tests/run-load-suite.sh` exporta logs y `summary.json` por escenario k6. |

## Limitaciones declaradas

| Tema | Estado actual | Justificacion |
| --- | --- | --- |
| Scanner operativo | DB-first: `/api/admin/scan` marca `USED` y registra `checkins.source = db`. | Permite validacion rapida de puerta. La redencion Soroban queda separada como flujo on-chain/indexer. |
| Redencion on-chain | El procesador del indexador ya proyecta `boleto_redimido` como `REDEEMED_ONCHAIN`; la ejecucion de `redimir_boleto` en Testnet se conserva como prueba manual. | Depende de cuenta Freighter/secret, RPC publico y disponibilidad de Testnet; no es estable para CI. |
| Checkout | Pago simulado con orden `PAID` y tickets emitidos. | No se integra pasarela fiat real por alcance academico. |
| E2E real | Cubre frontend, backend, PostgreSQL, checkout y scanner; no firma Freighter ni envia transacciones Soroban reales. | Freighter requiere interaccion de extension y Testnet introduce variabilidad externa. |
| Indexador | Hay integracion contra DB con eventos fake normalizados, replay y retry; no hay polling real de RPC en CI. | El polling depende del rango historico y disponibilidad del RPC publico. |
| NFT transfer | La autorizacion se prueba despues de `boleto_revendido` procesado; el burn/mint real se valida manualmente en Testnet. | Evita consumir Testnet y depender de contratos remotos durante la suite. |

## Comandos recomendados

Backend unitario:

```bash
cd backend
npm run test:unit
```

Backend API e integracion con DB local/test:

```bash
cd backend
DATABASE_URL_TEST="postgresql://..." npm run test:api
```

Frontend:

```bash
cd frontend
npm test
npm run e2e
npm run e2e:real
```

Carga:

```bash
BASE_URL=http://localhost:3000 load-tests/run-load-suite.sh
```
