# Development Workflow

## Objetivo

Definir una forma consistente de trabajar en el repositorio para mantener trazabilidad, claridad y control de cambios durante el desarrollo del proyecto.

---

## Rama principal

- `main`: rama estable del proyecto

La rama `main` debe mantenerse en un estado presentable y coherente.

No se debe trabajar directamente sobre `main`.

---

## Ramas de trabajo

Cada cambio importante debe realizarse en una rama separada.

### Convenciones

- `fix/...` para correcciones
- `feat/...` para nuevas funcionalidades
- `docs/...` para documentación
- `chore/...` para mantenimiento o limpieza
- `refactor/...` para reorganización interna sin cambiar comportamiento

### Ejemplos

- `fix/cart-idor`
- `fix/jwt-secret-config`
- `fix/submit-validation`
- `docs/contracts-audit`
- `chore/repo-cleanup`

---

## Flujo de trabajo

### Proceso recomendado

1. Identificar el problema o tarea
2. Crear un issue o dejar definida la tarea
3. Crear una rama desde `main`
4. Implementar el cambio
5. Hacer commits claros y pequeños
6. Subir la rama a GitHub
7. Abrir Pull Request
8. Revisar y hacer merge

### Ejemplo

```bash
git checkout main
git pull
git checkout -b fix/cart-idor