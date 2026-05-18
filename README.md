# Secure Ticket — Boletería Híbrida Web2.5 sobre Stellar

Secure Ticket es una plataforma académica de boletería digital que combina una experiencia web tradicional con trazabilidad blockchain sobre Stellar/Soroban. El proyecto busca reducir fraude, duplicidad de entradas y especulación en la reventa mediante boletos versionados, QR firmados, políticas configurables de reventa y contratos inteligentes por evento.

## Concepto Web2.5

El sistema no pretende ser una aplicación completamente descentralizada. Su diseño es híbrido:

1. **Capa Web2**: catálogo de eventos, autenticación, carrito, checkout simulado, administración, PQR y operación de puerta se gestionan desde una aplicación web tradicional.
2. **Capa Web3**: los contratos Soroban representan la lógica verificable de boletos, versiones, reventa, redención y NFT coleccionables en Stellar Testnet.
3. **Puente operacional**: el backend Express construye transacciones, valida reglas de negocio, registra evidencia en PostgreSQL y ejecuta un indexador que proyecta eventos on-chain hacia la base de datos.

## Alcance funcional

- Registro e inicio de sesión por roles: cliente, staff y administrador.
- Catálogo de eventos con búsqueda, filtros, imágenes y disponibilidad.
- Compra primaria con pago simulado para entorno académico.
- Selección de asientos para eventos con aforo interactivo.
- Emisión de tickets con QR firmado.
- Scanner operativo para validación en puerta y registro de check-ins.
- Aseguramiento de tickets en Soroban y emisión de NFT coleccionable cuando aplica.
- Reventa P2P con reglas anti-especulación por evento.
- Burn/remint de NFT después de reventa verificada.
- Políticas configurables de reventa: habilitación, precio máximo, porcentaje, ventana, bloqueo previo al evento y comisiones.
- Módulo PQR y reclamos con evidencia técnica del ticket, orden, evento y estado al momento del caso.
- Panel administrativo para eventos, contratos, políticas, scanner, PQR y despliegues.
- Pruebas automatizadas de backend, frontend, contratos, E2E y carga.

## Estructura del repositorio

```text
Secure-Ticket/
├── backend/                  # API Express, Prisma, PostgreSQL, indexador y scripts operativos
│   ├── prisma/               # Schema y migraciones
│   ├── scripts/              # Deploy, seed, reconciliación y utilidades
│   └── src/                  # Servidor, políticas, indexador y pruebas
│
├── frontend/                 # Aplicación React + Vite
│   ├── e2e/                  # Pruebas Playwright
│   └── src/                  # UI, páginas, contexto y componentes
│
├── contracts/                # Smart contracts Soroban en Rust
│   ├── contracts/
│   │   ├── event_contract/   # Compra, reventa, redención, versiones y eventos
│   │   ├── factory_contract/ # Registro/despliegue de contratos por evento
│   │   └── ticket_nft_contract/ # NFT coleccionable del boleto
│   └── wasm/                 # WASM local para despliegue, ignorado por git
│
├── docs/                     # Documentación técnica y operativa
├── load-tests/               # Escenarios k6
├── tooling/                  # Scripts de soporte para entorno y contratos
└── .github/                  # Workflows de validación
```

## Flujo principal

### 1. Exploración y compra

El usuario navega eventos desde el frontend. El backend responde desde PostgreSQL para mantener una experiencia rápida. Al confirmar compra se crea una orden con pago simulado y tickets activos.

### 2. Aseguramiento blockchain

El usuario puede asegurar su ticket en Soroban. El backend usa la configuración del evento y las cuentas de despliegue para registrar el boleto on-chain. Cuando el evento tiene contrato NFT, también intenta mintear el coleccionable asociado.

### 3. Reventa controlada

Antes de listar un ticket, el sistema valida:

- propiedad del ticket;
- estado activo;
- ausencia de listado duplicado;
- precio máximo permitido;
- ventana temporal de reventa;
- bloqueo antes del inicio del evento.

Cuando la reventa se confirma, el sistema conserva historial por versión: la versión anterior queda cancelada y la nueva versión queda activa para el comprador.

### 4. Operación de puerta

El QR del ticket está firmado y contiene identidad del ticket, versión y dueño esperado. El scanner valida el token, registra check-in y bloquea reuso. La redención operativa es DB-first; la redención on-chain está cubierta por contrato e indexación, y se documenta como una limitación operacional del prototipo.

### 5. PQR y trazabilidad

El usuario puede crear reclamos asociados a tickets, órdenes, eventos, reventas o validación en puerta. Cada caso conserva una fotografía técnica del estado del ticket y permite seguimiento por staff o administrador.

## Requisitos

- Node.js 20 o superior.
- PostgreSQL.
- Rust con targets Soroban configurados.
- Stellar CLI/Soroban CLI para compilar y desplegar contratos.
- Freighter Wallet configurada en Testnet para pruebas manuales Web3.
- k6 para pruebas de carga.

## Variables de entorno

El proyecto incluye archivos de ejemplo:

- `backend/.env.example`
- `frontend/.env.example`
- `contracts/.env.example`

Para desarrollo local se usan además archivos reales no versionados:

- `backend/.env`
- `backend/.env.deploy`
- `frontend/.env`

Estos archivos son necesarios para correr el proyecto localmente, pero están ignorados por git para evitar publicar secretos.

## Instalación local

Backend:

```bash
cd backend
npm install
npm run prisma:generate
npm run prisma:deploy
npm run start
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Contratos:

```bash
cd contracts
cargo test
```

## Validación y pruebas

Backend unitario:

```bash
cd backend
npm run test:unit
```

Backend API e integración:

```bash
cd backend
npm run test:api
```

Frontend:

```bash
cd frontend
npm test
```

E2E con mocks controlados:

```bash
cd frontend
npm run e2e
```

E2E real con backend y base de datos:

```bash
cd frontend
npm run e2e:real
```

Contratos Soroban:

```bash
cd contracts
cargo test
```

Pruebas de carga:

```bash
BASE_URL=http://localhost:3000 ./load-tests/run-load-suite.sh
```

## Limitaciones del prototipo

- El checkout usa pago simulado para fines académicos.
- La validación en puerta es DB-first; la redención on-chain existe en contratos y proyección del indexador, pero no bloquea el scanner operativo.
- Las pruebas E2E automatizadas no firman con Freighter real ni envían transacciones Soroban de extremo a extremo.
- La ejecución en Testnet depende de cuentas, fondos y disponibilidad del RPC público.

Estas limitaciones están documentadas para diferenciar el prototipo académico de una operación comercial en producción.

## Documentación

- `docs/architecture/ARCHITECTURE.md`
- `docs/architecture/MODELO_DATOS.md`
- `docs/architecture/CONTRACTS_TECHNICAL_REFERENCE.md`
- `docs/operations/RUNTIME_DEPLOYMENT.md`
- `docs/operations/ENVIRONMENTS.md`
- `docs/operations/LOAD_TESTING.md`
- `docs/operations/TESTING_LIMITATIONS.md`
- `contracts/README.md`

## Estado del proyecto

El proyecto se encuentra en fase de estabilización para sustentación: las funcionalidades principales están implementadas y la siguiente prioridad es mantener el alcance congelado, validar despliegues, preparar datos de demostración y documentar claramente el comportamiento real del sistema.
