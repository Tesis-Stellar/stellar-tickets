# Frontend Backlog

Este documento define las tareas derivadas de la auditoría del frontend, priorizadas por impacto y relación con la narrativa de la tesis.

---

## 🔴 Bloqueantes

### 1. Ajustar copy crítico de Web3
- Tipo: UX / Narrativa
- Prioridad: Alta
- Impacto: Alto
- Estado: Pendiente
- Descripción:
  Corregir textos que prometen más blockchain del que hoy existe realmente.
- Criterio de aceptación:
  - no se usa “NFT” de forma engañosa
  - no se vende como “P2P seguro” un flujo que no lo garantiza aún
  - scanner no se presenta como validación on-chain si no lo es

---

### 2. Bloquear reventa si ownership on-chain no está alineado
- Tipo: Integración / Dominio
- Prioridad: Alta
- Impacto: Alto
- Estado: Pendiente
- Descripción:
  La UI no debería permitir reventa como flujo normal si el owner on-chain real no es la wallet del usuario.
- Criterio de aceptación:
  - reventa se deshabilita o se marca como experimental cuando no hay ownership verificable
  - la UI no induce a error sobre quién controla el ticket

---

### 3. Alinear scanner con la realidad del backend
- Tipo: UX / Integración
- Prioridad: Alta
- Impacto: Alto
- Estado: Pendiente
- Descripción:
  El flujo de scan debe presentarse como validación backend o conectarse de verdad a `redimir_boleto`.
- Criterio de aceptación:
  - el copy refleja la implementación real
  - no se afirma redención on-chain inexistente

---

## 🟡 Importantes

### 4. Corregir `addToCart` para usar IDs reales
- Tipo: Consistencia
- Prioridad: Media
- Impacto: Medio
- Estado: Pendiente
- Criterio de aceptación:
  - el carrito usa IDs reales de backend o refresca inmediatamente tras agregar

---

### 5. Corregir `lastOrder.items`
- Tipo: UX / Consistencia
- Prioridad: Media
- Impacto: Medio
- Estado: Pendiente
- Criterio de aceptación:
  - la confirmación de compra muestra información útil y coherente

---

### 6. Corregir `ConnectWallet.tryLinkWallet`
- Tipo: Integración
- Prioridad: Media
- Impacto: Medio
- Estado: Pendiente
- Criterio de aceptación:
  - la UI no reporta éxito si backend no persistió realmente la wallet

---

### 7. Revisar `getEventById`
- Tipo: Robustez
- Prioridad: Media
- Impacto: Medio
- Estado: Pendiente
- Criterio de aceptación:
  - la búsqueda de evento usa un mecanismo consistente con la API real

---

### 8. Ajustar `AdminDashboard` al flujo real
- Tipo: Narrativa / Arquitectura
- Prioridad: Media
- Impacto: Medio
- Estado: Pendiente
- Criterio de aceptación:
  - el panel no presenta factory/descentralización si ese no es el despliegue real

---

### 9. Revisar `MySalesP2P`
- Tipo: Narrativa / Datos
- Prioridad: Media
- Impacto: Medio
- Estado: Pendiente
- Criterio de aceptación:
  - la UI no presenta ventas P2P como garantía on-chain si dependen de DB/indexador compensatorio

---

## 🟢 Deseables

### 10. Separar parcialmente `AppContext`
- Tipo: Arquitectura frontend
- Prioridad: Baja/Media
- Impacto: Medio
- Estado: Pendiente
- Descripción:
  Reducir concentración de responsabilidades.
- Posibles divisiones:
  - `AuthContext`
  - `CartContext`
  - `TicketsContext`

---

### 11. Mejorar manejo de errores
- Tipo: UX / Robustez
- Prioridad: Baja/Media
- Impacto: Medio
- Estado: Pendiente
- Criterio de aceptación:
  - errores mostrados al usuario son claros y no exponen texto crudo innecesario

---

### 12. Revisar `SeatSelection`
- Tipo: UX / Dominio
- Prioridad: Baja
- Impacto: Medio
- Estado: Pendiente
- Criterio de aceptación:
  - la UI no sugiere una reserva de asientos más robusta que la lógica real

---

### 13. Limpiar tooling/documentación heredada
- Tipo: Mantenimiento
- Prioridad: Baja
- Impacto: Bajo/Medio
- Estado: Pendiente
- Incluye:
  - revisar `openapi.v1.json`
  - revisar `QueryClientProvider`
  - remover o justificar artefactos no usados

---

## 📅 Plan sugerido

### Iteración 1
- copy crítico de Web3
- scanner
- guardas en reventa

### Iteración 2
- `addToCart`
- `lastOrder.items`
- `ConnectWallet`
- `getEventById`

### Iteración 3
- `AdminDashboard`
- `MySalesP2P`
- separación parcial de `AppContext`
- limpieza de tooling heredado

---

## Seguimiento

| Tarea | Estado | Rama | Issue |
|------|--------|------|-------|
| Ajustar copy crítico de Web3 | pendiente | - | - |
| Bloquear reventa sin ownership verificable | pendiente | - | - |
| Alinear scanner con flujo real | pendiente | - | - |
| Corregir `addToCart` | pendiente | - | - |
| Corregir `lastOrder.items` | pendiente | - | - |
| Corregir `ConnectWallet` | pendiente | - | - |
| Revisar `getEventById` | pendiente | - | - |
| Ajustar `AdminDashboard` | pendiente | - | - |
| Revisar `MySalesP2P` | pendiente | - | - |