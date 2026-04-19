# Contracts Backlog

Este documento define las tareas técnicas derivadas de la auditoría de contratos y su integración con el backend.

---

## 🔴 Bloqueantes

### 1. Alinear flujo de ownership on-chain
- Tipo: Dominio / Integración
- Prioridad: Alta
- Impacto: Alto
- Estado: Pendiente
- Descripción:
  El backend no puede seguir tratando al usuario como dueño on-chain si `crear_boleto` mintea al organizador.
- Criterio de aceptación:
  - existe una única narrativa clara de ownership
  - backend y contrato reflejan el mismo modelo
  - la documentación lo explica correctamente

---

### 2. Corregir flujo de reventa P2P
- Tipo: Dominio / Blockchain
- Prioridad: Alta
- Impacto: Alto
- Estado: Pendiente
- Descripción:
  Evitar que una supuesta reventa se ejecute como venta primaria on-chain.
- Criterio de aceptación:
  - el flujo P2P usa realmente la lógica de reventa del contrato
  - el vendedor correcto recibe el pago correcto
  - burn/remint ocurre cuando corresponde

---

### 3. Migrar listado/cancelación a XDR firmado por usuario
- Tipo: Seguridad / Integración
- Prioridad: Alta
- Impacto: Alto
- Estado: Pendiente
- Descripción:
  `list-ticket` y `cancel-listing` no deben depender de `ORGANIZER_SECRET` cuando la acción pertenece al propietario.
- Criterio de aceptación:
  - el usuario firma sus propias operaciones de listado/cancelación
  - `ORGANIZER_SECRET` queda restringido a funciones de organizador

---

### 4. Integrar redención on-chain real
- Tipo: Blockchain / Integración
- Prioridad: Alta
- Impacto: Alto
- Estado: Pendiente
- Descripción:
  El flujo `/api/admin/scan` debe reflejar la redención real en Soroban.
- Criterio de aceptación:
  - el scan dispara `redimir_boleto`
  - el estado on-chain cambia correctamente
  - PostgreSQL se alinea con el evento real

---

## 🟡 Importantes

### 5. Corregir lógica del indexador para ventas primarias vs P2P
- Tipo: Integración / Datos
- Prioridad: Media
- Impacto: Alto
- Estado: Pendiente
- Descripción:
  El indexador no debe inventar versiones o estados no emitidos por cadena.
- Criterio de aceptación:
  - la versión en DB proviene de eventos on-chain
  - no hay “versiones inventadas” por lógica compensatoria

---

### 6. Hacer el indexador paginado y seguro por cursor
- Tipo: Robustez
- Prioridad: Media
- Impacto: Alto
- Estado: Pendiente
- Descripción:
  Evitar pérdida de eventos por paginación o cursor mal avanzado.
- Criterio de aceptación:
  - los eventos se procesan sin saltos
  - el cursor avanza solo sobre eventos consumidos

---

### 7. Decidir si la factory es arquitectura real o no
- Tipo: Arquitectura / Documentación
- Prioridad: Media
- Impacto: Medio
- Estado: Pendiente
- Descripción:
  Hoy la factory existe, pero el backend no la usa en despliegue.
- Criterio de aceptación:
  - se usa la factory en despliegue real
  - o la documentación deja claro que el despliegue actual es directo

---

### 8. Revisar `wallet_organizador`
- Tipo: Dominio
- Prioridad: Media
- Impacto: Medio
- Estado: Pendiente
- Descripción:
  Definir si existe realmente una tesorería separada o si `organizador` y `wallet_organizador` son el mismo actor.
- Criterio de aceptación:
  - el contrato refleja el modelo final
  - la documentación no sugiere una separación inexistente

---

## 🟢 Deseables

### 9. Revisar validaciones menores del contrato
- Ejemplo: endurecer `cancelar_venta` con reglas más explícitas

### 10. Optimizar consultas O(n)
- Mejoras de rendimiento y escalabilidad

### 11. Endurecer CI de contratos
- No permitir `continue-on-error` donde no convenga

### 12. Actualizar roadmap/documentación técnica
- reflejar lo que ya está implementado
- eliminar pendientes ya resueltos

---

## 📅 Plan sugerido

### Iteración 1
- ownership on-chain
- flujo real de reventa
- listado/cancelación firmados por usuario

### Iteración 2
- redención on-chain
- indexador sin estados inventados
- cursor/paginación segura

### Iteración 3
- factory vs despliegue directo
- wallet_organizador
- CI y documentación

---

## Seguimiento

| Tarea | Estado | Rama | Issue |
|------|--------|------|-------|
| Ownership on-chain | pendiente | - | - |
| Reventa P2P real | pendiente | - | - |
| Listado/cancelación con firma de usuario | pendiente | - | - |
| Redención on-chain | pendiente | - | - |
| Indexador sin versiones inventadas | pendiente | - | - |
| Indexador con cursor seguro | pendiente | - | - |
| Factory vs despliegue real | pendiente | - | - |