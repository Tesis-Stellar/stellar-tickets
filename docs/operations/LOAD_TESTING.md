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

## Justificacion de concurrencia y duracion

Los numeros se eligieron para representar una demo academica y un evento pequeno, no una venta masiva nacional.

| Escenario | VUs | Duracion | Justificacion |
| --- | ---: | --- | --- |
| Lectura publica | 20 | 1 minuto | Simula varios usuarios navegando catalogo, detalle y recursos NFT al mismo tiempo. Es la ruta con mas probabilidad de concurrencia. |
| Login | 10 req/min, 5 VUs prealocados | 1 minuto | Login usa hashing, base de datos y rate limit de seguridad; se mide con tasa controlada para no confundir proteccion antiabuso con falla de rendimiento. |
| Scanner | 30 req/min, 5 VUs prealocados | 1 minuto | Representa varios validadores o intentos simultaneos en puerta sin exceder el rate limit definido para scanner. |

La duracion de 30 a 60 segundos permite estabilizar mediciones de percentil sin convertir la prueba en una carga prolongada sobre infraestructura gratuita o compartida.

## Criterios de aceptacion

| Endpoint | Criterio |
| --- | --- |
| `/health` | p95 menor a 300 ms |
| `/api/events` | p95 menor a 500 ms |
| `/api/events/:slug` | p95 menor a 700 ms |
| `/api/nft/metadata/:contract/:tokenId` | p95 menor a 500 ms |
| `/api/nft/qr/:contract/:tokenId.png` | p95 menor a 1000 ms |
| `/api/auth/login` | p95 menor a 3000 ms |
| `/api/admin/scan` | p95 menor a 800 ms |
| Todos | tasa de error menor a 1% |

Los codigos `400` y `409` pueden ser resultados esperados en scanner cuando se prueba QR invalido, usado o duplicado. En esos casos no se interpretan como fallo de disponibilidad, sino como rechazo funcional correcto.

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

## Limitaciones

- No mide rendimiento de Soroban Testnet ni del RPC publico.
- No automatiza Freighter, porque la firma de wallet es interactiva.
- No debe ejecutarse con alta concurrencia contra la base de datos de demo sin acordar una ventana de prueba.
- Checkout confirm y compra de reventa no se incluyen como carga automatica por ser flujos que crean datos y pueden contaminar la base de demo.

## Evidencia esperada

Para la sustentacion se recomienda guardar:

- salida completa de k6;
- fecha y ambiente de ejecucion;
- `BASE_URL` usado;
- VUs y duracion;
- percentiles p95;
- tasa de error;
- observaciones sobre errores esperados.
