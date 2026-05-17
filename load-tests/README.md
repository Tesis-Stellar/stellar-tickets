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

### Checkout guard

Modo no destructivo: requiere una cuenta de prueba autenticada con carrito activo vacio. Valida lectura de carrito y rechazos esperados de checkout vacio.

```bash
BASE_URL=http://localhost:3000 \
CHECKOUT_EMAIL=<EMAIL_DE_PRUEBA_CON_CARRITO_VACIO> \
CHECKOUT_PASSWORD='<PASSWORD_DE_PRUEBA>' \
k6 run load-tests/checkout-guard.k6.js
```

Por defecto usa 20 requests por minuto durante 1 minuto. Si la cuenta tiene items en el carrito, el script se detiene para evitar crear ordenes.

### Transaction guards

Modo no destructivo: valida que endpoints Web3 sensibles rechacen requests incompletos sin tocar Soroban ni crear eventos.

```bash
BASE_URL=http://localhost:3000 \
TRANSACTION_EMAIL=<EMAIL_DE_PRUEBA> \
TRANSACTION_PASSWORD='<PASSWORD_DE_PRUEBA>' \
k6 run load-tests/transactions-guard.k6.js
```

Por defecto usa 8 iteraciones por minuto durante 1 minuto. Cada iteracion ejecuta 3 requests, para mantenerse por debajo del rate limit transaccional.

### Lectura operativa admin/staff

Modo no destructivo: valida lectura publica de eventos y lectura autenticada de consola operativa (`admin/events`, `admin/contracts`, `admin/claims`). Sirve para sustentar el panel de Secure Ticket sin crear compras ni contratos.

```bash
BASE_URL=http://localhost:3000 \
ADMIN_EMAIL=<EMAIL_ADMIN> \
ADMIN_PASSWORD='<PASSWORD_ADMIN>' \
EVENT_ID=<EVENTO_CON_ASIENTOS_OPCIONAL> \
k6 run load-tests/operational-read.k6.js
```

También acepta `ADMIN_TOKEN` si ya tienes un JWT.

### Guardas de roles operativos

Modo no destructivo: prueba bajo carga que `ADMIN` y `STAFF` no puedan comprar, confirmar checkout ni vincular wallet. Cada iteración espera `403` en todos los endpoints sensibles.

```bash
BASE_URL=http://localhost:3000 \
ADMIN_EMAIL=<EMAIL_ADMIN> \
ADMIN_PASSWORD='<PASSWORD_ADMIN>' \
STAFF_EMAIL=<EMAIL_STAFF> \
STAFF_PASSWORD='<PASSWORD_STAFF>' \
k6 run load-tests/role-guard.k6.js
```

También acepta `ADMIN_TOKEN` y `STAFF_TOKEN`.

## Suite completa con reportes

Para generar evidencia anexable, usa:

```bash
BASE_URL=http://localhost:3000 \
EVENT_SLUG=<SLUG_DE_EVENTO> \
NFT_CONTRACT_ADDRESS=<NFT_CONTRACT_ADDRESS> \
NFT_TOKEN_ID=<TOKEN_ID> \
LOAD_TEST_EMAIL=<EMAIL_DE_PRUEBA> \
LOAD_TEST_PASSWORD='<PASSWORD>' \
SCANNER_EMAIL=<EMAIL_STAFF_O_ADMIN> \
SCANNER_PASSWORD='<PASSWORD>' \
CHECKOUT_EMAIL=<EMAIL_CARRITO_VACIO> \
CHECKOUT_PASSWORD='<PASSWORD>' \
TRANSACTION_EMAIL=<EMAIL_DE_PRUEBA> \
TRANSACTION_PASSWORD='<PASSWORD>' \
ADMIN_EMAIL=<EMAIL_ADMIN> \
ADMIN_PASSWORD='<PASSWORD_ADMIN>' \
STAFF_EMAIL=<EMAIL_STAFF> \
STAFF_PASSWORD='<PASSWORD_STAFF>' \
load-tests/run-load-suite.sh
```

La salida queda en `load-tests/results/<timestamp>/` con logs, `summary.json` y archivo de ambiente.

## Parametros comunes

- `BASE_URL`: API objetivo. Default: `http://localhost:3000`.
- `VUS`: cantidad de usuarios virtuales.
- `RATE`: requests por minuto en escenarios controlados.
- `DURATION`: duracion del escenario.

Ejemplo:

```bash
VUS=10 DURATION=45s k6 run load-tests/public-read.k6.js
```
