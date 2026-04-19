# Roadmap Técnico de Contratos - Stellar Tickets

## 1) Diagnóstico actual
El contrato actual implementa flujo base de ticketing:
- Inicialización con organizer/platform/token y comisiones.
- Creación, listado, compra, cancelación de venta y canje.
- Venta primaria y reventa con distribución de comisiones.
- Pruebas unitarias funcionales para casos principales.

Brechas frente al diseño definido para tesis:
- No existe `factory` por evento (solo contrato único).
- No existe `burn + remint` por reventa con `ticket_root_id` y versión.
- No existe rol de verificador para canje en puerta.
- No hay eventos on-chain estructurados para indexación completa.
- No hay soporte formal de invalidación masiva por evento.
- Lecturas `get_*` escalan O(n) y deben apoyarse en indexador off-chain.

---

## 2) ¿Solo con este contrato alcanza?
No. Para cumplir el alcance técnico definido, se necesitan al menos estos componentes:

### En blockchain (obligatorio)
1. **Contrato Factory**
   - Crea un contrato por evento.
   - Registra metadatos mínimos del evento y address del contrato hijo.
2. **Contrato Evento (versión nueva del actual)**
   - Lógica de tickets, reventa atómica, burn/remint, comisiones, canje.

### Fuera de blockchain (obligatorio)
3. **Backend API**
   - Orquesta llamadas de negocio.
   - Aplica reglas operativas no críticas on-chain.
4. **Indexador de eventos + PostgreSQL**
   - Construye historial de propiedad y vistas rápidas.
   - Resuelve trazabilidad académica sin costos altos en contrato.
5. **Servicio de verificación QR (online/offline sync)**
   - Firma y valida payload de acceso.
   - Reconciliación de check-ins offline.

### Cliente (obligatorio para demo)
6. **Web de ticketera (white-label simulado)**
   - Admin B2B, marketplace B2C y módulo de verificación.

---

## 3) Alcance de contrato recomendado (MVP tesis)

## 3.1 Factory Contract
Funciones mínimas:
- `initialize_factory(platform_admin, platform_wallet)`
- `create_event_contract(ticketera_admin, event_id, token, fee_ticketera_bp, fee_plataforma_bp, wallet_ticketera, wallet_plataforma)`
- `get_event_contract(event_id)`
- `list_event_contracts_by_ticketera(ticketera_admin)` (si no escala, resolver en indexador)

Eventos mínimos:
- `EventContractCreated(event_id, contract_address, ticketera_admin)`

## 3.2 Event Contract
Modelo mínimo del ticket:
- `ticket_root_id` (estable por vida del ticket lógico)
- `version` (incrementa por cada reventa)
- `owner`
- `price`
- `for_sale`
- `used`
- `invalidated`

Funciones mínimas:
- `initialize_event(...)`
- `mint_primary_stub(...)` (solo inventario/asignación inicial)
- `assign_primary(...)`
- `list_ticket(root_id, version, new_price)`
- `cancel_listing(root_id, version)`
- `buy_ticket_atomic(root_id, version, buyer)`
- `redeem_ticket(root_id, version, verifier)`
- `invalidate_ticket(root_id, version)`
- `invalidate_event(event_id)` (opcional MVP+, recomendado)
- `get_ticket(root_id, version)`
- `get_current_version(root_id)`

Eventos on-chain para indexador:
- `TicketMinted`
- `TicketListed`
- `TicketSaleCancelled`
- `TicketResold` (incluye old_version y new_version)
- `TicketRedeemed`
- `TicketInvalidated`

Reglas clave:
- Reventa atómica: pagos + burn versión previa + mint nueva versión en una sola operación.
- Comisión fija por evento al momento de creación del contrato.
- Precio libre (sin tope) en v1.

---

## 4) Backlog por fases (ejecutable)

## Fase A - Hardening del contrato actual (2-3 días)
Objetivo: reducir deuda técnica antes de split factory/event.
- [ ] Tipar errores (enum) en vez de `panic!` de texto.
- [x] Estandarizar validaciones (`price > 0`, estados inválidos).
- [x] Añadir pruebas de bordes faltantes.
- [x] Actualizar README con comandos reales del proyecto.

Salida: base más estable para refactor.

## Fase B - Separación en Factory + Event (4-6 días)
Objetivo: cumplir diseño “1 contrato por evento”.
- [x] Crear `contracts/factory_contract`.
- [x] Migrar contrato actual a `contracts/event_contract`.
- [x] Definir interfaz base entre factory y contrato evento.
- [x] Pruebas unitarias por contrato + pruebas de integración base entre ambos.

Pendiente dentro de Fase B:
- [ ] Deploy real del contrato hijo desde `factory_contract`.
- [ ] Flujo completo de despliegue en testnet.

Salida: arquitectura blockchain alineada a diseño.

## Fase C - Versionado de ticket (burn/remint) (3-5 días)
Objetivo: trazabilidad fuerte por `root_id`.
- [ ] Añadir `ticket_root_id` y `version`.
- [ ] Implementar `buy_ticket_atomic` con burn+remint.
- [ ] Emitir eventos estructurados de transición.
- [ ] Ajustar pruebas de propiedad/historial.

Salida: política antifraude principal implementada.

## Fase D - Verificación operativa (2-4 días)
Objetivo: habilitar entrada al evento.
- [ ] Agregar rol de verificador/admin en contrato evento.
- [ ] `redeem_ticket` por rol autorizado (no por owner).
- [ ] Reglas de no reutilización de ticket redimido.

Salida: flujo de acceso validable en demo.

## Fase E - Integración externa mínima (4-7 días)
Objetivo: demo académica completa en testnet.
- [ ] Backend API para operaciones de negocio.
- [ ] Indexador de eventos on-chain a PostgreSQL.
- [ ] Endpoint de historial por `ticket_root_id`.
- [ ] Módulo QR y sincronización offline.

Nota operativa:
- La parte off-chain ya vive en `../off_chain` dentro del mismo monorepo.

Salida: E2E funcional para sustentación.

## Fase F - Testnet + evidencia de tesis (2-3 días)
Objetivo: generar evidencia verificable.
- [ ] Deploy factory + un contrato evento en testnet.
- [ ] Script de demo reproducible.
- [ ] Captura de tx hashes, tiempos, costos y casos de prueba.

Salida: material de evaluación y capítulo de resultados.

---

## 5) Qué NO meter en esta iteración
- KYC real.
- Pasarela fiat real.
- Integraciones con ticketeras externas reales.
- Mainnet productivo.

---

## 6) Criterio de "listo para demo testnet"
- Factory despliega contrato por evento en testnet.
- Flujo E2E: listar -> comprar -> burn/remint -> verificar acceso.
- Historial visible por `ticket_root_id` en backend/indexador.
- Validación online y offline con sincronización posterior.
- Evidencia técnica documentada (hashes, tiempos, costos).

---

## 7) Riesgos técnicos y mitigación
1. **Complejidad de burn/remint**
   - Mitigar con pruebas de regresión por transición de estado.
2. **Consulta costosa on-chain**
   - Mitigar con indexador + PostgreSQL como fuente de lectura.
3. **Conflictos offline de check-in**
   - Mitigar con política de reconciliación: primer check-in sincronizado gana.
4. **Errores de autorización**
   - Mitigar con roles explícitos y pruebas negativas por función.

---

## 8) Checklist de alineación con guías Stellar/Soroban

- [ ] Todas las funciones críticas usan `require_auth` del actor correcto.
- [ ] Los eventos on-chain cubren creación, listado, compra, canje, cancelación e invalidación.
- [ ] Las claves de storage están tipadas por dominio (`Administrador`, `ContratoEvento(id)`, etc.).
- [ ] No hay lógica de consulta histórica costosa on-chain que deba vivir en indexador.
- [ ] Las pruebas incluyen casos negativos de auth, comisiones inválidas, capacidad inválida y duplicados.
- [ ] El deploy en testnet deja evidencias reproducibles (hashes, direcciones, costos, tiempos).
