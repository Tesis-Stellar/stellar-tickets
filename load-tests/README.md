# Secure Ticket load tests

Suite minima de carga para validar los caminos HTTP mas importantes del prototipo sin depender de Freighter ni de firmas interactivas.

## Herramienta

Se usa k6 porque:

- ejecuta escenarios reproducibles desde CLI;
- reporta latencia promedio, percentiles, throughput y tasa de error;
- permite thresholds que fallan automaticamente si el endpoint no cumple el criterio;
- no requiere modificar el backend.

Instalacion local:

```bash
brew install k6
```

## Escenarios

### Lectura publica

```bash
BASE_URL=http://localhost:3000 \
EVENT_SLUG=<SLUG_DE_EVENTO> \
NFT_CONTRACT_ADDRESS=<NFT_CONTRACT_ADDRESS> \
NFT_TOKEN_ID=<TOKEN_ID> \
k6 run load-tests/public-read.k6.js
```

Por defecto usa 20 usuarios virtuales durante 1 minuto.

### Login

```bash
BASE_URL=http://localhost:3000 \
LOAD_TEST_EMAIL=<EMAIL_DE_PRUEBA> \
LOAD_TEST_PASSWORD='<PASSWORD_DE_PRUEBA>' \
k6 run load-tests/auth.k6.js
```

Por defecto usa 10 requests por minuto durante 1 minuto, con 5 VUs prealocados.

### Scanner

Modo no destructivo por defecto: envia un QR invalido autenticado y espera 400.

```bash
BASE_URL=http://localhost:3000 \
SCANNER_EMAIL=<EMAIL_STAFF_O_ADMIN> \
SCANNER_PASSWORD='<PASSWORD_DE_PRUEBA>' \
k6 run load-tests/scanner.k6.js
```

Por defecto usa 30 requests por minuto durante 1 minuto, con 5 VUs prealocados.

Modo con QR real: el primer request puede marcar el ticket como usado y los siguientes deben responder 409. Usarlo solo con fixtures temporales.

```bash
BASE_URL=http://localhost:3000 \
SCANNER_EMAIL=<EMAIL_STAFF_O_ADMIN> \
SCANNER_PASSWORD='<PASSWORD_DE_PRUEBA>' \
SCAN_QR_TOKEN='ey...' \
k6 run load-tests/scanner.k6.js
```

## Parametros comunes

- `BASE_URL`: API objetivo. Default: `http://localhost:3000`.
- `VUS`: cantidad de usuarios virtuales.
- `RATE`: requests por minuto en escenarios controlados.
- `DURATION`: duracion del escenario.

Ejemplo:

```bash
VUS=10 DURATION=45s k6 run load-tests/public-read.k6.js
```
