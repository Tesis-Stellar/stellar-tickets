# Especificación de Eventos On-Chain

Documento que define qué eventos debe emitir el contrato Soroban para integración con off-chain.

## Eventos Planeados (Fase B+)

El contrato emitirá eventos en JSON serializado como strings on-chain. El indexador escuchará y procesará.

### 1. `TicketMinted`
**Cuándo**: Al crear un boleto nuevo
**Campos**:
```json
{
  "id_boleto": u32,
  "id_evento": u32,
  "propietario": String (Address),
  "precio": i128,
  "timestamp": u64,
  "tipo": "primario"
}
```
**Acción off-chain**: Insertar en `boletos_raiz` + crear entry en `boletos_version` v0.

---

### 2. `TicketListedForSale`
**Cuándo**: Boleto se marca para venta
**Campos**:
```json
{
  "id_boleto": u32,
  "id_evento": u32,
  "propietario": String,
  "precio": i128,
  "es_reventa": bool,
  "timestamp": u64
}
```
**Acción off-chain**: Actualizar `boletos_version.en_venta = true` + insertar en `listados_reventa`.

---

### 3. `TicketResold`
**Cuándo**: Se completa compra en reventa
**Campos**:
```json
{
  "id_boleto": u32,
  "id_evento": u32,
  "vendedor": String,
  "comprador": String,
  "precio_reventa": i128,
  "comision_organizador": i128,
  "comision_plataforma": i128,
  "comision_vendedor": i128,
  "wallets_pagadas": {
    "wallet_organizador": String,
    "wallet_plataforma": String,
    "wallet_vendedor": String
  },
  "hash_transaccion": String (Stellar tx hash),
  "timestamp": u64,
  "versión": u32
}
```
**Acción off-chain**: 
- Crear nueva `boletos_version` con versión incrementada
- Insertar en `transacciones_reventa`
- Actualizar auditoría
- **CRÍTICO**: Usar `hash_transaccion` como idempotence key para no reindexar duplicados

---

### 4. `TicketRedeemed`
**Cuándo**: Boleto es redimido (usado en evento)
**Campos**:
```json
{
  "id_boleto": u32,
  "id_evento": u32,
  "propietario_actual": String,
  "usado": true,
  "timestamp": u64,
  "verificador": String (Address que validó - Fase D)
}
```
**Acción off-chain**: 
- Actualizar `boletos_version.usado = true` + `marcado_en = timestamp, por = verificador`
- Insertar en `checkins`
- Marcar en caché offline como "ya procesado"

---

### 5. `TicketCancelled`
**Cuándo**: Se cancela la venta de un boleto listado
**Campos**:
```json
{
  "id_boleto": u32,
  "id_evento": u32,
  "propietario": String,
  "razon": String (opcional),
  "timestamp": u64
}
```
**Acción off-chain**: Eliminar de `listados_reventa` + actualizar `boletos_version.en_venta = false`.

---

### 6. `TicketInvalidated` (Burn en Fase C)
**Cuándo**: Ticket es quemado en reventa (Fase C - burn+remint)
**Campos**:
```json
{
  "id_boleto": u32,
  "ticket_root_id": u32,
  "version_anterior": u32,
  "version_nueva": u32,
  "vendedor_anterior": String,
  "comprador_nuevo": String,
  "hash_tx_quemado": String,
  "hash_tx_remintado": String,
  "timestamp": u64
}
```
**Acción off-chain**: Auditoría + marcar v_antigua como `quemada = true` + crear nueva version.

---

## Patrón de Idempotencia

**Problema**: Las transacciones Stellar pueden emitir el mismo evento múltiples veces en reorg o retransmisión.

**Solución**:
1. Todo evento debe incluir `hash_transaccion` (Stellar tx hash) + `timestamp`
2. Indexador inserta en tabla con UNIQUE constraint en  `(hash_transaccion, evento_tipo)`
3. Si intenta reindexar mismo evento: ignora (ya existe)

```sql
CREATE UNIQUE INDEX idx_evento_idempotencia 
ON eventos_procesados(hash_transaccion, tipo_evento)
WHERE procesado = true;
```

---

## Timeline de Implementación

- **Fase A** (Actual): Contrato compila, tests pasan (sin eventos)
- **Fase B**: Añadir eventos on-chain + refactor a factory/event
- **Fase C**: Implement burn+remint, emitir `TicketInvalidated`
- **Fase D**: Rol verificador, separar redeem auth
- **Fase E**: Indexador consume eventos
- **Fase F**: Testnet + métricas

---

## Notas Arquitectónicas

### ¿Por qué JSON strings vs. structured logging?
- Stellar no tiene tipos complejos; serializar a JSON permite flexibilidad.
- Off-chain parsea JSON y valida estructura esperada.
- Cambios futuros: agregar versión de evento (`"evento_version": 2`) para evolucionar sin romper.

### ¿Qué si el indexador se cae?
- Eventos quedan en blockchain; recuperables por re-scanning desde último block procesado.
- Tabla `indexador_cursor` guarda "último block procesado".
- Al reiniciar: escanea desde ahí (no desde genesis).

### ¿Reconciliación off-chain?
- Cada 24h o manual: comparar `boletos_raiz` off-chain vs. on-chain balance via RPC query.
- Si divergencias: trigger auditoría + alert.
