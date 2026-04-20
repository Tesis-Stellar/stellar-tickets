# Stellar Tickets Tesis - Estado Actual y Próximos Pasos

**Fecha**: Marzo 16, 2026  
**Estado**: Monorepo consolidado, on-chain validado y off-chain listo para integración

---

## 1. Resumen ejecutivo

### Técnico

- `event_contract` está funcional y validado con pruebas.
- `factory_contract` ya tiene control administrativo, registro por evento, validaciones y evento on-chain de creación.
- `off_chain/` ya tiene estructura, esquema de datos y documentación suficiente para empezar implementación real.

### Para dummies

- La lógica crítica del boleto ya existe en blockchain.
- La página web todavía necesita conectarse a esa lógica.
- El siguiente paso no es rediseñar contratos desde cero, sino unir contratos + backend + frontend + wallet.

---

## 2. Qué ya está hecho

### On-chain

- [x] `event_contract` compila
- [x] `event_contract` pasa 27 tests
- [x] `factory_contract` compila
- [x] `factory_contract` pasa 11 tests
- [x] Validaciones principales de precios, comisiones y autorización
- [x] `cargo check` sin errores de compilación

### Off-chain

- [x] Estructura monorepo Node/Turbo
- [x] Apps base: `api`, `indexador`, `verificador`, `web`
- [x] Paquete `shared-types`
- [x] Docker Compose de desarrollo
- [x] Esquema PostgreSQL definido
- [x] Documentos de arquitectura, eventos y guía rápida

---

## 3. Qué falta

### On-chain

- [ ] Implementar deploy real del contrato hijo desde `factory_contract`
- [ ] Desplegar factory + contratos evento en testnet/futurenet
- [ ] Fijar IDs y direcciones para que el off-chain las consuma

### Off-chain

- [ ] Implementar indexador real que lea eventos on-chain
- [ ] Implementar API real sobre PostgreSQL
- [ ] Conectar frontend a wallet y contratos
- [ ] Integrar flujo E2E mínimo

### Operación

- [ ] Variables de entorno reales de testnet
- [ ] Despliegue estable de la demo
- [ ] Runbook de mantenimiento y hotfixes

---

## 4. Flujo mínimo que debe quedar funcionando

1. Crear o registrar evento desde factory.
2. Consultar contrato del evento desde off-chain.
3. Crear y listar boleto.
4. Comprar boleto desde la web con wallet.
5. Ver el resultado reflejado en base de datos/indexador.
6. Redimir boleto y visualizar el cambio de estado.

Cuando ese flujo corra en testnet, ya se puede decir que el sistema está integrado de verdad.

---

## 5. Orden recomendado de trabajo

### Opción 1: cerrar on-chain primero

1. Deploy real desde `factory_contract`.
2. Deploy en testnet.
3. Exportar IDs de contrato al off-chain.

### Opción 2: avanzar en paralelo

1. Un integrante termina deploy real on-chain.
2. Otro implementa indexador, API y frontend usando contratos ya definidos.
3. Se unen ambos cuando existan direcciones reales en testnet.

La opción 2 es la más eficiente.

---

## 6. Qué puede hacer ya el compañero de off-chain

- Implementar el cliente RPC para consultar `factory_contract` y `event_contract`.
- Montar PostgreSQL con el esquema actual.
- Construir el indexador con base en eventos esperados.
- Construir endpoints API para eventos, boletos y reventas.
- Construir el frontend con placeholders de contrato configurables por `.env`.

No necesita esperar a que todo el on-chain esté terminado para arrancar.

---

## 7. Criterio de listo para demo web

Se considera listo cuando:

- Factory y al menos un contrato evento están desplegados en testnet.
- La web permite al usuario conectar wallet y firmar.
- El indexador refleja el estado real de los eventos.
- La API responde datos consistentes desde PostgreSQL.
- Se puede correr el flujo crear/listar/comprar/redimir sin intervención manual rara.

---

## 8. Recomendación inmediata

1. Completar deploy real desde `factory_contract`.
2. En paralelo, empezar implementación real de `off_chain/`.
3. Fijar una primera demo en testnet con un solo evento y pocos boletos.

---

## 9. Documento de entrada recomendado

Para entender el proyecto rápido:

1. `../README.md`
2. `../docs/ARCHITECTURE.md`
3. `../docs/QUICK_REFERENCE.md`
4. `../../tesis_main_contract/ROADMAP_TECNICO_CONTRATOS.md`

---

## 10. Checklist de implementación off-chain alineado a Stellar

- [ ] Consumir eventos y estado por RPC (evitar dependencias implícitas de Horizon para contratos).
- [ ] Definir idempotencia del indexador por `tx_hash + event_index + contract_id`.
- [ ] Versionar el esquema de base de datos para reprocesar bloques/eventos sin corrupción.
- [ ] Manejar reintentos y backoff para ingestión RPC (fallas transitorias de red).
- [ ] Exponer en API el `tx_hash` y `contract_id` para trazabilidad end-to-end.
- [ ] Integrar wallet en web con manejo explícito de firma rechazada/expirada.
- [ ] Separar secretos y endpoints por entorno (`local`, `testnet`, `futurenet`).
