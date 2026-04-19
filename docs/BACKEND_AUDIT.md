# Backend Audit

## Resumen ejecutivo

El backend de Stellar Tickets cumple como prototipo funcional de una arquitectura Web2.5, integrando catálogo Web2, autenticación tradicional y lógica on-chain sobre Stellar Soroban.

Sin embargo, presenta debilidades relevantes en:
- seguridad básica
- consistencia entre estado Web2 y blockchain
- control de concurrencia
- claridad arquitectónica
- ausencia de pruebas automatizadas

No es un sistema incorrecto, pero requiere endurecimiento para ser defendible a nivel de ingeniería.

---

## Arquitectura

### Estado actual
- Monolito basado en Express (`server.ts`)
- Mezcla de:
  - rutas HTTP
  - lógica de negocio
  - acceso a base de datos (Prisma)
  - integración con Soroban
- Indexador separado (`indexer.ts`) ejecutado en el mismo proceso o externamente

### Problemas
- Alto acoplamiento
- Baja testabilidad
- difícil mantenimiento a medida que crece el sistema

---

## Seguridad

### Hallazgos

- Uso de `JWT_SECRET` por defecto en desarrollo
- Riesgo de **IDOR** (Insecure Direct Object Reference) en operaciones de carrito
- Validaciones insuficientes en endpoints críticos (ej. submit de transacciones)
- Posible exposición de errores internos en respuestas HTTP

### Riesgos

- Acceso a recursos de otros usuarios
- uso indebido del backend como relay de transacciones
- filtración de información sensible

---

## Lógica de negocio

### Problema principal

Desalineación potencial entre:
- estado en base de datos (Web2)
- estado real en blockchain (Soroban)

Ejemplo:
- ownership de boletos no siempre coincide entre DB y contrato

### Otros problemas

- validaciones incompletas
- reglas de negocio dispersas
- ambigüedad en flujo de compra vs reventa

---

## Integración blockchain

### Estado actual

- Construcción de XDR en backend
- Firma en cliente (wallet)
- envío y polling de resultados
- indexador para sincronización

### Problemas

- falta de idempotencia en operaciones críticas
- manejo limitado de errores en RPC
- sincronización eventual no controlada
- dependencia fuerte del indexador sin reconciliación formal

### Riesgos

- inconsistencias entre DB y blockchain
- duplicación de eventos
- estados intermedios incorrectos

---

## Concurrencia y consistencia

### Problemas

- posibilidad de doble checkout
- falta de bloqueo lógico en carrito
- ausencia de control transaccional robusto
- posibles condiciones de carrera entre indexador y API

### Riesgos

- sobreventa de tickets
- duplicación de órdenes
- inconsistencias difíciles de corregir

---

## Base de datos

### Problemas

- constraints insuficientes (unicidad, relaciones)
- posibles duplicados (ej. carrito activo)
- falta de validaciones a nivel DB para integridad crítica

---

## API

### Problemas

- inconsistencia en endpoints (slug vs id)
- respuestas heterogéneas
- falta de estandarización de errores
- ausencia de versionado

---

## Testing

### Estado

- no hay pruebas automatizadas en backend

### Riesgos

- regresiones silenciosas
- comportamiento no verificable
- mayor dificultad para refactorizar

---

## Manejo de errores

### Problemas

- manejo manual en cada endpoint
- sin middleware centralizado
- exposición de errores internos en algunos casos

---

## Conclusión

El backend es adecuado como prototipo funcional, pero requiere mejoras en:

- seguridad
- consistencia de datos
- control de concurrencia
- claridad arquitectónica

Estas mejoras son necesarias para que el sistema sea defendible en un contexto académico y técnico más exigente.