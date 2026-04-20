# Backend Backlog

Este documento define las tareas técnicas necesarias para mejorar el backend, priorizadas por impacto y urgencia.

---

## 🔴 Bloqueantes (críticos)

### 1. Eliminar uso de JWT por defecto
- Tipo: Seguridad
- Impacto: Alto
- Descripción: Forzar el uso de `JWT_SECRET` definido en entorno
- Criterio de aceptación:
  - el servidor no arranca sin `JWT_SECRET` en producción
  - no existe fallback inseguro

---

### 2. Corregir IDOR en carrito
- Tipo: Seguridad
- Impacto: Alto
- Descripción: Validar que los recursos pertenecen al usuario autenticado
- Criterio de aceptación:
  - ningún usuario puede modificar recursos de otro
  - validación explícita en endpoints

---

### 3. Validar submit de transacciones
- Tipo: Seguridad / Blockchain
- Impacto: Alto
- Descripción: Restringir uso del endpoint de envío de transacciones
- Criterio de aceptación:
  - el backend no acepta XDR arbitrarios sin validación
  - validación de contexto usuario-wallet

---

### 4. Evitar doble checkout
- Tipo: Consistencia
- Impacto: Alto
- Descripción: Evitar que un mismo carrito se procese múltiples veces
- Criterio de aceptación:
  - estado del carrito cambia de forma atómica
  - no se generan órdenes duplicadas

---

### 5. Definir modelo de ownership Web2/Web3
- Tipo: Dominio
- Impacto: Alto
- Descripción: Alinear claramente quién es dueño del ticket en cada capa
- Criterio de aceptación:
  - documentación clara del flujo
  - consistencia entre DB y blockchain

---

## 🟡 Importantes

### 6. Implementar idempotencia
- Aplicar a:
  - checkout
  - secure-ticket
  - submit
- Criterio:
  - múltiples ejecuciones no generan duplicados

---

### 7. Estandarizar API
- Unificar uso de slug vs id
- respuestas consistentes
- estructura de errores uniforme

---

### 8. Mejorar indexador
- actualizar correctamente todos los campos relevantes
- manejar errores y reintentos
- limpiar estados inconsistentes

---

### 9. Validar precios on-chain vs backend
- evitar discrepancias entre lógica Web2 y contrato

---

## 🟢 Deseables

### 10. Refactorizar estructura del backend
- separar rutas, servicios y acceso a datos
- reducir tamaño de `server.ts`

---

### 11. Middleware centralizado de errores
- manejo uniforme
- logging estructurado

---

### 12. Implementar pruebas básicas
- auth
- carrito
- checkout
- endpoints críticos

---

## 📅 Plan sugerido

### Iteración 1
- JWT
- IDOR
- submit validation

### Iteración 2
- checkout
- ownership
- idempotencia

### Iteración 3
- API
- indexador
- refactor

---

## Notas

Este backlog debe evolucionar a medida que se identifiquen nuevos problemas o se avance en la implementación.