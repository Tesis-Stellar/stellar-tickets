# Environments

## Objetivo

Definir como se separan los ambientes del proyecto para probar cambios sin afectar la demo estable.

## Regla principal

- `develop` alimenta el ambiente de pruebas (`staging`).
- `main` alimenta el ambiente estable de demo / produccion academica.
- No se trabaja directo sobre `develop` ni sobre `main`; los cambios entran por Pull Request.

## Ambientes

### Staging

Ambiente para probar y romper cosas antes de promover cambios.

- Rama fuente: `develop`
- Backend: Railway `backend-staging`
- Frontend: Vercel `frontend-staging`
- Base de datos: `db-staging`
- Wallets: cuentas Stellar testnet dedicadas a staging
- Contratos: contratos testnet dedicados a staging cuando aplique

Variables backend:

```env
NODE_ENV=production
DATABASE_URL=<staging database url>
JWT_SECRET=<staging jwt secret>
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
ORGANIZER_SECRET=<staging organizer secret>
ORGANIZER_PUBLIC=<staging organizer public key>
```

Variables frontend:

```env
VITE_API_BASE_URL=https://<backend-staging-url>
```

### Demo / Produccion Academica

Ambiente estable para presentar el proyecto.

- Rama fuente: `main`
- Backend: Railway `backend-demo`
- Frontend: Vercel `frontend-demo`
- Base de datos: `db-demo`
- Wallets: cuentas Stellar testnet dedicadas a demo
- Contratos: contratos testnet documentados para demo

Variables backend:

```env
NODE_ENV=production
DATABASE_URL=<demo database url>
JWT_SECRET=<demo jwt secret>
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
ORGANIZER_SECRET=<demo organizer secret>
ORGANIZER_PUBLIC=<demo organizer public key>
```

Variables frontend:

```env
VITE_API_BASE_URL=https://<backend-demo-url>
```

## Flujo de Cambios

1. Crear una rama de trabajo desde `develop`.
2. Implementar el cambio.
3. Abrir Pull Request hacia `develop`.
4. Al hacer merge, se despliega staging.
5. Probar el flujo afectado en staging.
6. Si staging esta correcto, abrir Pull Request de `develop` hacia `main`.
7. Al hacer merge a `main`, se despliega la demo / produccion academica.

## Configuracion En Monorepo

El repositorio es un monorepo. Cada servicio debe apuntar a su carpeta raiz.

Backend Railway:

```text
Root Directory: backend
Build Command: npm install && npm run build
Start Command: npm start
```

Frontend Vercel:

```text
Root Directory: frontend
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
```

## Smoke Tests De Staging

Antes de promover a `main`, validar:

- `GET /health` responde correctamente en backend staging.
- El frontend staging carga sin 404.
- El frontend staging usa `VITE_API_BASE_URL` de backend staging, no `localhost`.
- Registro/login funciona.
- Catalogo y detalle de evento cargan.
- Carrito funciona.
- Checkout funciona.
- Mis entradas funciona.
- Flujos blockchain se prueban con wallets staging.
- Scanner se prueba contra datos staging.

## Reglas De Cuidado

- No usar la base de datos demo para pruebas.
- No usar wallets demo para pruebas.
- No guardar secrets en el repositorio.
- No promover a `main` si staging no paso smoke test.
- Documentar direcciones de contratos demo en `docs/operations/TESTNET_DEPLOYMENTS.md`.
