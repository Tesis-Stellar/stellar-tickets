# Stellar Tickets — Backend

API **Express** con **Prisma** sobre PostgreSQL. Actúa como capa Web2.5: catálogo y autenticación Web2, construcción de transacciones Soroban (XDR) para que el cliente firme en la wallet, y un **indexador** para sincronizar eventos on-chain con la base de datos según el entorno de ejecución.

Actualmente el despliegue principal del backend se realiza en **Railway**.

## Requisitos

- Node.js **20+**
- PostgreSQL (local, Docker o proveedor gestionado)
- Wallet compatible con **Stellar Testnet** (por ejemplo Freighter) para pruebas del frontend

## Estructura de carpetas

```text
backend/
├── api/index.ts       # Punto de entrada alterno / serverless
├── src/
│   ├── server.ts      # API Express principal
│   ├── indexer.ts     # Sincronización Soroban -> PostgreSQL
│   └── types.d.ts
├── prisma/            # schema.prisma, seed y migraciones
├── scripts/           # Utilidades de despliegue, seed y mantenimiento
├── .env.example
├── package.json
└── vercel.json        # Configuración heredada / alternativa
```

## Puesta en marcha (local)

1. Instalar dependencias (desde esta carpeta):

   ```bash
   npm install
   ```

2. Configurar variables de entorno:

   ```bash
   cp .env.example .env
   ```

   Edita `.env` con tu `DATABASE_URL` y el resto de variables (ver tabla más abajo).

3. Generar el cliente de Prisma (también se ejecuta en `postinstall`):

   ```bash
   npm run prisma:generate
   ```

4. Aplicar migraciones al esquema `ticketing`:

   ```bash
   npm run prisma:migrate
   ```

5. Arrancar el servidor en modo desarrollo (recarga con `tsx watch`):

   ```bash
   npm run dev
   ```

Por defecto la API escucha en `http://localhost:3000`. Puedes comprobar disponibilidad básica con `GET /health`.

### Indexador Soroban

En entornos de proceso largo (por ejemplo `npm run dev` o `npm start` fuera de entornos serverless), la aplicación puede ejecutar `runIndexer()` dentro del mismo proceso para sincronizar eventos Soroban hacia PostgreSQL.

Si la indexación continua se ejecuta por separado en tu despliegue, debe apuntar al mismo `DATABASE_URL` que utiliza la API.

## Scripts npm

| Script                      | Descripción                                      |
|-----------------------------|--------------------------------------------------|
| `npm run dev`               | Servidor con recarga automática (`tsx watch`)   |
| `npm start`                 | Servidor sin watch                               |
| `npm run build`             | Ejecuta `tsc` según `package.json` (`--noEmitOnError false` y `|| true`: no falla el script aunque TypeScript reporte errores) |
| `npm run prisma:generate`   | Cliente Prisma                                   |
| `npm run prisma:migrate`    | Migraciones en desarrollo                        |
| `npm run prisma:deploy`     | Migraciones en CI/producción                     |

## Variables de entorno

| Variable            | Obligatoria | Descripción |
|---------------------|------------|-------------|
| `DATABASE_URL`      | Sí         | URL de PostgreSQL (incluye `?schema=ticketing` si aplica). |
| `PORT`              | No         | Puerto HTTP (por defecto `3000`). |
| `JWT_SECRET`        | No*        | Firma de tokens JWT. En cualquier despliegue serio debe definirse explícitamente y ser fuerte. |
| `SOROBAN_RPC_URL`   | No         | RPC Soroban (por defecto testnet público). |
| `ORGANIZER_SECRET`  | No**       | Secret key del organizador para operaciones que construyen/envían transacciones desde el backend. |
| `ORGANIZER_PUBLIC`  | No         | Clave pública del organizador usada en rutas admin/contratos si no quieres el valor por defecto del código. |
| `VERCEL`            | No         | En despliegues serverless la define el proveedor; si existe, `server.ts` no ejecuta el bloque de proceso largo (`listen` + `runIndexer()`). |

\* En desarrollo puede existir un valor por defecto en el código, pero no debe usarse en entornos compartidos, demos públicas o producción.

\*\* Sin `ORGANIZER_SECRET`, algunas rutas on-chain responderán con error de servicio no configurado.

Copia `.env.example` a `.env` y ajusta valores; las claves de organizador suelen ser solo locales o secretos del proveedor, nunca en el repositorio.

## API (resumen)

Todas las rutas REST bajo prefijo `/api` salvo `/` y `/health`.

- **Catálogo**: `GET /api/events`, `GET /api/events/:slug`, tipos de boleto, relacionados, etc.
- **Auth**: `POST /api/auth/login`, `POST /api/auth/register`, `GET/PATCH /api/users/me`, wallet del usuario.
- **Transacciones**: compra, listado, cancelación, XDR para firma en cliente, submit, etc.
- **Carrito y checkout**: carrito autenticado, preview y confirmación.
- **Pedidos y boletos**: órdenes, boletos del usuario, vendidos.
- **Admin** (JWT + rol): venues, eventos, despliegue de contratos, escaneo, etc.

Para detalles de rutas, payloads y modelos, consulta la implementación actual del backend (`src/server.ts`) y la documentación técnica del monorepo.

## Despliegue

Actualmente el backend se despliega en **Railway**.

El repositorio conserva `api/index.ts` y `vercel.json` como parte de una configuración previa orientada a entornos serverless / Vercel, pero ese no es el despliegue principal actual.

En el entorno principal, el backend corre como proceso Node de larga duración y puede ejecutar el indexador según la configuración del entorno y las variables disponibles.

## Documentación del monorepo

- Visión general: [README del repositorio](../README.md)
- Contratos Soroban: [contracts/DOCUMENTACION_CONTRATOS.md](../contracts/DOCUMENTACION_CONTRATOS.md)
- Datos y arquitectura: carpeta [docs/](../docs/)
