# Project Backlog

Este documento consolida los hallazgos técnicos del proyecto **Stellar Tickets** como sistema completo.

Su objetivo es priorizar el trabajo pendiente de forma realista, alineada con:
- el alcance de la tesis
- la coherencia entre frontend, backend y contratos
- la preparación para demo y sustentación

---

## Criterios de priorización

### Bloqueantes
Problemas que afectan directamente:
- seguridad básica
- consistencia del sistema
- narrativa técnica de la tesis
- credibilidad de la demo

### Importantes
Problemas que no destruyen la demo, pero sí reducen:
- solidez técnica
- claridad del sistema
- mantenibilidad
- confianza en la integración

### Deseables
Mejoras útiles, pero no críticas para la sustentación.

### Fuera de alcance
Cambios que serían valiosos en un producto real, pero no son prioridad para este trabajo de grado.

---

## 🔴 Bloqueantes

### 1. Corregir el modelo de ownership entre backend y contratos
- Componente: Backend + Contracts + Frontend
- Prioridad: Alta
- Impacto: Muy alto
- Estado: Pendiente
- Problema:
  El backend y el frontend sugieren que el usuario pasa a ser dueño on-chain del ticket, pero el contrato `crear_boleto` asigna inicialmente ownership al organizador.
- Riesgo:
  rompe la trazabilidad, la narrativa de custodia y la coherencia del sistema.
- Criterio de aceptación:
  - existe una definición única y explícita de ownership
  - backend, frontend y contratos reflejan la misma realidad
  - la documentación técnica lo explica correctamente

---

### 2. Corregir el flujo real de reventa P2P
- Componente: Backend + Contracts + Frontend
- Prioridad: Alta
- Impacto: Muy alto
- Estado: Pendiente
- Problema:
  La UI y el backend presentan la reventa como P2P, pero el flujo puede terminar ejecutándose como venta primaria on-chain.
- Riesgo:
  el vendedor no cobra como se espera, no ocurre burn/remint cuando debería y la tesis promete un modelo de reventa más fuerte que el real.
- Criterio de aceptación:
  - la reventa P2P usa realmente la lógica correcta del contrato
  - la UI no presenta como P2P lo que no lo es
  - pagos, ownership y versiones quedan alineados con cadena

---

### 3. Corregir IDOR en endpoints de carrito
- Componente: Backend
- Prioridad: Alta
- Impacto: Alto
- Estado: Pendiente
- Problema:
  Riesgo de que un usuario pueda modificar recursos que no le pertenecen.
- Riesgo:
  falla de seguridad básica defendible negativamente en revisión técnica.
- Criterio de aceptación:
  - el backend valida ownership del recurso
  - no se puede modificar ni eliminar carrito ajeno

---

### 4. Eliminar el uso inseguro de `JWT_SECRET` por defecto
- Componente: Backend
- Prioridad: Alta
- Impacto: Alto
- Estado: Pendiente
- Problema:
  existe fallback de desarrollo que no debe sostenerse como práctica aceptable.
- Riesgo:
  seguridad débil y mala señal de ingeniería.
- Criterio de aceptación:
  - la configuración deja claro cuándo es válido en desarrollo
  - no queda normalizado como mecanismo aceptable para despliegues serios
  - la documentación lo refleja correctamente

---

### 5. Alinear el scanner con la realidad del sistema
- Componente: Frontend + Backend + Contracts
- Prioridad: Alta
- Impacto: Alto
- Estado: Pendiente
- Problema:
  la UI del scanner sugiere validación/redención on-chain, pero el backend hoy opera principalmente sobre DB.
- Riesgo:
  la demo promete una garantía antifraude más fuerte que la implementada.
- Criterio de aceptación:
  - o se conecta a `redimir_boleto`
  - o se presenta explícitamente como validación backend/Web2
  - la UI no induce a error

---

### 6. Restringir y validar mejor el endpoint `submit`
- Componente: Backend
- Prioridad: Alta
- Impacto: Alto
- Estado: Pendiente
- Problema:
  el backend acepta XDR firmado con validación insuficiente del contexto de negocio.
- Riesgo:
  pérdida de control y trazabilidad del flujo on-chain.
- Criterio de aceptación:
  - el endpoint no acepta XDR arbitrario sin validación mínima
  - existe relación clara entre usuario, wallet y operación enviada

---

## 🟡 Importantes

### 7. Evitar doble checkout
- Componente: Backend
- Prioridad: Media/Alta
- Impacto: Alto
- Estado: Pendiente
- Problema:
  el mismo carrito podría procesarse más de una vez.
- Criterio de aceptación:
  - no se generan órdenes duplicadas para el mismo flujo
  - el cambio de estado del carrito es atómico o suficientemente controlado

---

### 8. Corregir el indexador para no inventar estado
- Componente: Backend + Contracts
- Prioridad: Media/Alta
- Impacto: Alto
- Estado: Pendiente
- Problema:
  el indexador intenta compensar desalineaciones creando estados/versiones que no vienen realmente de cadena.
- Criterio de aceptación:
  - la DB refleja eventos reales
  - no hay versiones inventadas por lógica compensatoria

---

### 9. Hacer el indexador seguro frente a paginación/cursor
- Componente: Backend
- Prioridad: Media/Alta
- Impacto: Alto
- Estado: Pendiente
- Problema:
  riesgo de saltarse eventos on-chain.
- Criterio de aceptación:
  - el cursor avanza de forma segura
  - no se pierden eventos por lotes/paginación

---

### 10. Ajustar el copy crítico del frontend
- Componente: Frontend
- Prioridad: Media
- Impacto: Alto
- Estado: Pendiente
- Problema:
  términos como “NFT”, “P2P seguro”, “custodiado por Soroban” o “validación on-chain” exageran el estado actual del sistema.
- Criterio de aceptación:
  - la UI describe con precisión lo que el sistema hace hoy
  - se reduce el riesgo de afirmaciones engañosas en demo/sustentación

---

### 11. Bloquear o advertir reventa cuando no haya ownership verificable
- Componente: Frontend + Backend
- Prioridad: Media
- Impacto: Alto
- Estado: Pendiente
- Problema:
  la UI permite acciones de reventa que no siempre están respaldadas por ownership on-chain del usuario.
- Criterio de aceptación:
  - la UI no habilita el flujo como si fuera plenamente válido cuando no lo es
  - existe una guarda o advertencia clara

---

### 12. Decidir si la factory forma parte de la arquitectura real
- Componente: Contracts + Backend + Docs
- Prioridad: Media
- Impacto: Medio/Alto
- Estado: Pendiente
- Problema:
  la documentación y el contrato factory existen, pero el despliegue real parece hacerse directamente por contrato de evento.
- Criterio de aceptación:
  - o la factory entra al flujo real
  - o la documentación deja claro que no es la ruta actual de despliegue

---

### 13. Corregir problemas funcionales pequeños del frontend
- Componente: Frontend
- Prioridad: Media
- Impacto: Medio
- Estado: Pendiente
- Incluye:
  - `addToCart` con IDs temporales
  - `lastOrder.items` vacío
  - `ConnectWallet` reportando éxito indebidamente
  - `getEventById` frágil
- Criterio de aceptación:
  - los flujos demo clave se comportan de forma consistente y confiable

---

### 14. Mejorar consistencia de API y errores
- Componente: Backend
- Prioridad: Media
- Impacto: Medio
- Estado: Pendiente
- Problema:
  respuestas heterogéneas, errores expuestos y naming inconsistente.
- Criterio de aceptación:
  - errores más uniformes
  - menos ambigüedad entre rutas
  - menor exposición de detalles internos

---

## 🟢 Deseables

### 15. Separar parcialmente `AppContext`
- Componente: Frontend
- Prioridad: Baja/Media
- Impacto: Medio
- Estado: Pendiente
- Objetivo:
  reducir concentración de responsabilidades y facilitar mantenimiento.

---

### 16. Dividir parcialmente `server.ts`
- Componente: Backend
- Prioridad: Baja/Media
- Impacto: Medio
- Estado: Pendiente
- Objetivo:
  extraer rutas/servicios para mejorar claridad y testabilidad.

---

### 17. Endurecer CI de contratos
- Componente: Contracts / CI
- Prioridad: Baja
- Impacto: Medio
- Estado: Pendiente
- Objetivo:
  mejorar señal de calidad y evitar tolerar fallos relevantes.

---

### 18. Revisar `openapi.v1.json` y tooling heredado
- Componente: Frontend / Docs
- Prioridad: Baja
- Impacto: Bajo/Medio
- Estado: Pendiente
- Objetivo:
  decidir si sigue siendo artefacto vivo o si debe salir del flujo del proyecto.

---

### 19. Revisar documentación técnica obsoleta
- Componente: Docs
- Prioridad: Baja
- Impacto: Medio
- Estado: Pendiente
- Objetivo:
  alinear roadmap, arquitectura y setup con el estado real actual.

---

### 20. Añadir pruebas mínimas de integración/demostración
- Componente: Backend + Frontend + Contracts
- Prioridad: Baja/Media
- Impacto: Medio
- Estado: Pendiente
- Objetivo:
  cubrir al menos los flujos más críticos de demo:
  - checkout
  - asegurar ticket
  - listar/reventa
  - scanner

---

## ⚪ Fuera de alcance por ahora

### A. Reescribir completamente la arquitectura del backend
No es necesario para sostener la tesis si se corrigen primero seguridad, consistencia y narrativa.

### B. Convertir el frontend en una app enterprise
No es el objetivo del trabajo; basta con que sea consistente, clara y defendible como demo/validación.

### C. Optimización profunda de contratos para escala
Las mejoras O(n), performance extrema y hardening productivo son valiosas, pero no prioritarias para la sustentación.

### D. Reorganización profunda del monorepo
La higiene actual es suficiente; no vale la pena entrar ahora en Turborepo, Nx, `apps/` o `packages/`.

---

## Plan sugerido por iteraciones

### Iteración 1 — Correcciones de credibilidad y seguridad
- JWT
- IDOR carrito
- `submit`
- copy crítico frontend
- scanner alineado con realidad
- ownership como decisión/documentación explícita

### Iteración 2 — Consistencia entre capas
- reventa P2P real
- indexador sin estados inventados
- bloqueo/advertencia en reventa
- checkout sin duplicación

### Iteración 3 — Solidez técnica adicional
- factory vs despliegue real
- problemas pequeños del frontend
- consistencia de API
- separación parcial de contextos/archivos

---

## Seguimiento

| Tarea | Componente | Prioridad | Estado | Rama | Issue |
|------|------------|-----------|--------|------|-------|
| Ownership Web2/Web3 | Backend + Contracts + Frontend | Alta | pendiente | - | - |
| Reventa P2P real | Backend + Contracts + Frontend | Alta | pendiente | - | - |
| IDOR carrito | Backend | Alta | pendiente | - | - |
| JWT secret | Backend | Alta | pendiente | - | - |
| Scanner alineado con realidad | Frontend + Backend + Contracts | Alta | pendiente | - | - |
| Validación de submit | Backend | Alta | pendiente | - | - |
| Evitar doble checkout | Backend | Media/Alta | pendiente | - | - |
| Indexador sin estados inventados | Backend + Contracts | Media/Alta | pendiente | - | - |
| Cursor seguro en indexador | Backend | Media/Alta | pendiente | - | - |
| Copy crítico frontend | Frontend | Media | pendiente | - | - |
| Guardas en reventa | Frontend + Backend | Media | pendiente | - | - |
| Factory vs despliegue real | Contracts + Backend + Docs | Media | pendiente | - | - |