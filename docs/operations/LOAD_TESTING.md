# Pruebas de carga

## Objetivo

Validar que los endpoints HTTP mas importantes de Secure Ticket mantienen tiempos de respuesta aceptables bajo concurrencia moderada, sin convertir la prueba en un stress test destructivo sobre Supabase, Stellar Testnet o el RPC publico.

Estas pruebas complementan las pruebas unitarias, de integracion y manuales. No reemplazan la validacion funcional de Freighter ni la confirmacion on-chain.

## Herramienta seleccionada

Se selecciono k6 por cuatro razones:

1. Permite definir escenarios reproducibles como codigo.
2. Entrega metricas utiles para la tesis: latencia, percentiles, throughput y tasa de error.
3. Permite thresholds automatizados para decidir si una prueba pasa o falla.
4. No requiere modificar la aplicacion ni introducir dependencias runtime en backend/frontend.

## Endpoints elegidos

| Escenario | Endpoint | Motivo |
| --- | --- | --- |
| Catalogo publico | `GET /api/events` | Es el punto de entrada mas consultado por usuarios no autenticados. |
| Detalle de evento | `GET /api/events/:slug` | Es el paso previo a compra y seleccion de boleta. |
| Metadata NFT | `GET /api/nft/metadata/:contract/:tokenId` | Es consultado por wallets y exploradores para mostrar el coleccionable. |
| QR NFT | `GET /api/nft/qr/:contract/:tokenId.png` | Sirve la imagen escaneable asociada al NFT. |
| Login | `POST /api/auth/login` | Valida un flujo critico de autenticacion sin depender de wallet. |
| Scanner | `POST /api/admin/scan` | Es el flujo operativo mas sensible durante la entrada al evento. |
| Checkout guard | `GET /api/cart`, `POST /api/checkout/preview`, `POST /api/checkout/confirm` | Valida que checkout responda de forma estable ante carrito vacio, sin crear ordenes. |
| Transaction guards | `POST /api/transactions/submit`, `POST /api/transactions/submit-classic`, `POST /api/transactions/transfer-nft` | Valida rechazos controlados en rutas Web3 sensibles sin tocar Soroban. |

## Justificacion de concurrencia y duracion

Los numeros se eligieron para representar una demo academica y un evento pequeno, no una venta masiva nacional.

| Escenario | VUs | Duracion | Justificacion |
| --- | ---: | --- | --- |
| Lectura publica | 20 | 1 minuto | Simula varios usuarios navegando catalogo, detalle y recursos NFT al mismo tiempo. Es la ruta con mas probabilidad de concurrencia. |
| Login | 10 req/min, 5 VUs prealocados | 1 minuto | Login usa hashing, base de datos y rate limit de seguridad; se mide con tasa controlada para no confundir proteccion antiabuso con falla de rendimiento. |
| Scanner | 30 req/min, 5 VUs prealocados | 1 minuto | Representa varios validadores o intentos simultaneos en puerta sin exceder el rate limit definido para scanner. |
| Checkout guard | 20 req/min, 5 VUs prealocados | 1 minuto | Checkout es mutante; por defecto se prueba con carrito vacio para medir validacion, autenticacion y consultas sin crear ordenes. |
| Transaction guards | 8 iter/min, 5 VUs prealocados | 1 minuto | Cada iteracion ejecuta 3 requests, para un maximo aproximado de 24 requests/min y sin exceder el rate limit transaccional de 30/min. |

La duracion de 30 a 60 segundos permite estabilizar mediciones de percentil sin convertir la prueba en una carga prolongada sobre infraestructura gratuita o compartida.

## Criterios de aceptacion

| Endpoint | Criterio |
| --- | --- |
| `/health` | p95 menor a 300 ms |
| `/api/events` | p95 menor a 1200 ms |
| `/api/events/:slug` | p95 menor a 700 ms |
| `/api/nft/metadata/:contract/:tokenId` | p95 menor a 500 ms |
| `/api/nft/qr/:contract/:tokenId.png` | p95 menor a 1000 ms |
| `/api/auth/login` | p95 menor a 3000 ms |
| `/api/admin/scan` | p95 menor a 800 ms |
| `/api/cart` | p95 menor a 3000 ms |
| `/api/checkout/preview` carrito vacio | p95 menor a 2500 ms |
| `/api/checkout/confirm` carrito vacio | p95 menor a 5000 ms |
| `/api/transactions/submit` rechazo temprano | p95 menor a 1000 ms |
| `/api/transactions/submit-classic` rechazo temprano | p95 menor a 800 ms |
| `/api/transactions/transfer-nft` rechazo temprano | p95 menor a 1000 ms |
| Todos | tasa de error menor a 1% |

Los codigos `400` y `409` pueden ser resultados esperados en scanner cuando se prueba QR invalido, usado o duplicado. En esos casos no se interpretan como fallo de disponibilidad, sino como rechazo funcional correcto.

Los codigos `400`, `403`, `409` y `503` pueden ser resultados esperados en transaction guards cuando el request se rechaza antes de llegar a Soroban. La prueba mide estabilidad y proteccion de borde, no confirmacion on-chain.

El umbral de `/api/events` es mas amplio que `/health` porque consulta catalogo, filtros y agregados de disponibilidad sobre PostgreSQL remoto; en staging se acepta hasta 1.2 s p95 para evitar falsos negativos por latencia de red, pero se debe investigar si supera ese valor.

Los umbrales de checkout son mas amplios porque el escenario no destructivo recorre carrito, validacion de checkout y limpieza de reservas contra PostgreSQL remoto antes de rechazar. Para checkout real de produccion deberia existir una prueba separada con fixtures temporales e infraestructura dedicada.

## Comandos

Lectura publica:

```bash
BASE_URL=http://localhost:3000 \
EVENT_SLUG=<SLUG_DE_EVENTO> \
NFT_CONTRACT_ADDRESS=<NFT_CONTRACT_ADDRESS> \
NFT_TOKEN_ID=<TOKEN_ID> \
k6 run load-tests/public-read.k6.js
```

Login:

```bash
BASE_URL=http://localhost:3000 \
LOAD_TEST_EMAIL=<EMAIL_DE_PRUEBA> \
LOAD_TEST_PASSWORD='<PASSWORD_DE_PRUEBA>' \
k6 run load-tests/auth.k6.js
```

Scanner no destructivo:

```bash
BASE_URL=http://localhost:3000 \
SCANNER_EMAIL=<EMAIL_STAFF_O_ADMIN> \
SCANNER_PASSWORD='<PASSWORD_DE_PRUEBA>' \
k6 run load-tests/scanner.k6.js
```

Checkout no destructivo:

```bash
BASE_URL=http://localhost:3000 \
CHECKOUT_EMAIL=<EMAIL_DE_PRUEBA_CON_CARRITO_VACIO> \
CHECKOUT_PASSWORD='<PASSWORD_DE_PRUEBA>' \
k6 run load-tests/checkout-guard.k6.js
```

Transaction guards:

```bash
BASE_URL=http://localhost:3000 \
TRANSACTION_EMAIL=<EMAIL_DE_PRUEBA> \
TRANSACTION_PASSWORD='<PASSWORD_DE_PRUEBA>' \
k6 run load-tests/transactions-guard.k6.js
```

Suite con evidencia exportable:

```bash
BASE_URL=http://localhost:3000 \
EVENT_SLUG=<SLUG_DE_EVENTO> \
NFT_CONTRACT_ADDRESS=<NFT_CONTRACT_ADDRESS> \
NFT_TOKEN_ID=<TOKEN_ID> \
LOAD_TEST_EMAIL=<EMAIL_DE_PRUEBA> \
LOAD_TEST_PASSWORD='<PASSWORD_DE_PRUEBA>' \
SCANNER_EMAIL=<EMAIL_STAFF_O_ADMIN> \
SCANNER_PASSWORD='<PASSWORD_DE_PRUEBA>' \
CHECKOUT_EMAIL=<EMAIL_DE_PRUEBA_CON_CARRITO_VACIO> \
CHECKOUT_PASSWORD='<PASSWORD_DE_PRUEBA>' \
TRANSACTION_EMAIL=<EMAIL_DE_PRUEBA> \
TRANSACTION_PASSWORD='<PASSWORD_DE_PRUEBA>' \
ADMIN_EMAIL=<EMAIL_ADMIN> \
ADMIN_PASSWORD='<PASSWORD_ADMIN>' \
STAFF_EMAIL=<EMAIL_STAFF> \
STAFF_PASSWORD='<PASSWORD_STAFF>' \
load-tests/run-load-suite.sh
```

El script crea `load-tests/results/<timestamp>/` con:

- `*.summary.json`: resumen estructurado de k6 para anexos;
- `*.log`: salida completa de cada corrida;
- `environment.txt`: ambiente y fecha de ejecucion;
- `*.skipped.txt`: escenarios omitidos por falta de credenciales.

## Limitaciones

- No mide rendimiento de Soroban Testnet ni del RPC publico.
- No automatiza Freighter, porque la firma de wallet es interactiva.
- No debe ejecutarse con alta concurrencia contra la base de datos de demo sin acordar una ventana de prueba.
- Checkout real, compra de reventa, mint NFT y transferencia NFT real no se ejecutan por defecto como carga automatica porque crean datos, consumen tickets o dependen de Soroban Testnet.
- Para medir esos flujos se deben crear fixtures temporales, usar idempotency keys controladas y limpiar la base despues de la corrida.

## Evidencia esperada

Para la sustentacion se recomienda guardar:

- salida completa de k6;
- fecha y ambiente de ejecucion;
- `BASE_URL` usado;
- VUs y duracion;
- percentiles p95;
- tasa de error;
- observaciones sobre errores esperados.
