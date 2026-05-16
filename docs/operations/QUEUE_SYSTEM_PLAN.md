# Plan de sistema de colas

## Estado actual

Secure Ticket no usa una cola externa. El backend procesa requests HTTP de forma sincrona con Express, PostgreSQL y Soroban RPC. El indexer corre como proceso long-lived y usa tablas idempotentes para evitar reprocesar eventos on-chain.

Mecanismos actuales relacionados:

| Area | Mecanismo actual |
| --- | --- |
| Requests HTTP | Express procesa cada request directamente |
| Checkout | Transacciones Prisma/PostgreSQL e idempotency key |
| Scanner | Validacion sincrona y escritura en `checkins` |
| Web3 submit | Validacion de `transaction_intents` y envio directo a Soroban RPC |
| Indexer | Proceso long-lived con cursor y `onchain_events` idempotente |
| Retry NFT pendiente | Reintentos desde backend cuando el usuario vuelve a intentar asegurar/mint |
| Rate limit | Buckets en memoria del proceso |
| Cache | Cache en memoria del proceso |

## Problema que resolveria una cola

Algunos trabajos no deberian depender de que un request HTTP permanezca abierto ni de que el usuario espere la respuesta completa:

- mint o remint de NFT pendiente;
- procesamiento de eventos on-chain;
- reconciliacion entre Soroban y PostgreSQL;
- liberacion periodica de reservas expiradas;
- envio de correos o notificaciones;
- auditoria diferida y reportes operativos.

## Metodo recomendado

Para este proyecto se recomienda empezar con **transactional outbox sobre PostgreSQL** y un worker Node.js separado.

La razon es practica:

1. El proyecto ya depende de PostgreSQL.
2. Los jobs pueden crearse en la misma transaccion que cambia el estado de negocio.
3. No agrega Redis, RabbitMQ, SQS ni otra infraestructura antes de la entrega.
4. Mantiene trazabilidad para la tesis: job creado, intentos, error, estado y resultado.
5. Permite migrar despues a BullMQ, RabbitMQ o SQS si el producto crece.

## Modelo propuesto

Tabla `job_queue`:

| Campo | Tipo | Uso |
| --- | --- | --- |
| `id` | UUID | Identificador del job |
| `type` | TEXT | Tipo: `nft.mint_pending`, `indexer.process_range`, etc. |
| `status` | TEXT | `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `DEAD` |
| `payload` | JSONB | Datos minimos del trabajo |
| `idempotency_key` | TEXT UNIQUE | Evita duplicar jobs equivalentes |
| `available_at` | TIMESTAMPTZ | Permite retries diferidos |
| `attempts` | INTEGER | Intentos realizados |
| `max_attempts` | INTEGER | Limite de reintentos |
| `locked_at` | TIMESTAMPTZ | Marca de worker en ejecucion |
| `locked_by` | TEXT | Identificador del worker |
| `last_error` | TEXT | Ultimo error resumido |
| `created_at` | TIMESTAMPTZ | Creacion |
| `updated_at` | TIMESTAMPTZ | Ultima actualizacion |

Indices minimos:

- `UNIQUE(idempotency_key)`;
- `(status, available_at)`;
- `(type, status)`;
- `(locked_at)` para recuperar jobs abandonados.

## Flujo del worker

1. El backend crea un job dentro de la misma transaccion de negocio.
2. El worker toma jobs `PENDING` con `available_at <= now()`.
3. El worker bloquea el job con `FOR UPDATE SKIP LOCKED`.
4. Ejecuta el handler segun `type`.
5. Si termina, marca `SUCCEEDED`.
6. Si falla, incrementa `attempts` y programa `available_at` con backoff.
7. Si supera `max_attempts`, marca `DEAD` y deja `last_error`.

## Jobs iniciales recomendados

| Job | Prioridad | Motivo |
| --- | --- | --- |
| `nft.mint_pending` | Alta | Permite que asegurar boleto no dependa de completar mint en el request. |
| `nft.remint_after_resale` | Alta | Mantiene coherencia de NFT despues de reventa confirmada. |
| `indexer.process_range` | Media | Permite dividir procesamiento on-chain en rangos reintentables. |
| `reconciliation.run` | Media | Detecta diferencias entre `onchain_events` y tickets proyectados. |
| `seat_holds.release_expired` | Media | Limpia reservas vencidas sin depender de requests de usuarios. |
| `notification.send` | Baja | Envia confirmaciones sin bloquear checkout. |

## Cambios de codigo por fases

### Fase 1: outbox minima

- Crear migracion `job_queue`.
- Agregar helper `enqueueJob(type, payload, idempotencyKey)`.
- Agregar worker `backend/src/jobs/worker.ts`.
- Implementar solo `nft.mint_pending`.
- Agregar script `npm run jobs:worker`.
- Agregar tests unitarios de idempotencia, retry y dead-letter.

### Fase 2: operaciones Web3

- Mover retry de mint pendiente a `nft.mint_pending`.
- Encolar `nft.remint_after_resale` despues de reventa confirmada.
- Registrar `txHash`, `ticketRootId`, `version`, `wallet` y `nftContractAddress` en payload.
- Mantener endpoints HTTP devolviendo estado `PENDING`, `CONFIRMED` o `FAILED`.

### Fase 3: indexer y reconciliacion

- Encolar rangos de ledger o eventos detectados.
- Reintentar fallos transitorios de RPC.
- Agregar job periodico de reconciliacion.
- Generar reporte operativo con diferencias detectadas.

### Fase 4: escalamiento futuro

Si el volumen crece, migrar handlers a BullMQ + Redis, RabbitMQ o SQS. El contrato de jobs debe mantenerse igual: `type`, `payload`, `idempotency_key`, `status` y `attempts`.

## Por que no implementarlo completo antes de la entrega

La cola mejora robustez operacional, pero introduce nuevos riesgos de despliegue:

- worker separado que debe estar siempre activo;
- monitoreo de jobs fallidos;
- migraciones adicionales;
- limpieza de jobs antiguos;
- nuevos casos de carrera si se implementa rapido.

Para la entrega academica, el sistema actual puede defenderse como Web2.5 sin cola externa porque ya usa transacciones, idempotencia e indexer persistente. La cola debe presentarse como mejora operacional inmediata posterior al cierre funcional.

## Criterios de aceptacion cuando se implemente

- Crear dos jobs iguales con la misma `idempotency_key` deja un solo registro.
- Un job fallido se reintenta con backoff.
- Un job excedido queda `DEAD` con `last_error`.
- Dos workers no procesan el mismo job al tiempo.
- `nft.mint_pending` puede fallar una vez y luego completar sin duplicar NFT.
- El backend no pierde la orden/ticket aunque el worker este apagado.
