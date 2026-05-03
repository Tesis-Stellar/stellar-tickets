# Development Workflow

## Objetivo

Definir una forma consistente de trabajar en el repositorio para mantener trazabilidad, claridad y control de cambios durante el desarrollo del proyecto.

---

## Ramas Principales

- `develop`: rama de integracion y pruebas; alimenta el ambiente `staging`.
- `main`: rama estable del proyecto; alimenta el ambiente demo / produccion academica.

La rama `main` debe mantenerse en un estado presentable y coherente. La rama `develop` puede recibir cambios validados por Pull Request para probarlos en staging antes de promoverlos.

No se debe trabajar directamente sobre `develop` ni sobre `main`.

---

## Ramas De Trabajo

Cada cambio importante debe realizarse en una rama separada creada desde `develop`.

### Convenciones

- `fix/...` para correcciones
- `feat/...` para nuevas funcionalidades
- `docs/...` para documentacion
- `chore/...` para mantenimiento o limpieza
- `refactor/...` para reorganizacion interna sin cambiar comportamiento

### Ejemplos

- `fix/cart-idor`
- `fix/jwt-secret-config`
- `fix/submit-validation`
- `docs/contracts-audit`
- `chore/repo-cleanup`

---

## Flujo De Trabajo

### Proceso recomendado

1. Identificar el problema o tarea.
2. Crear un issue o dejar definida la tarea.
3. Crear una rama desde `develop`.
4. Implementar el cambio.
5. Hacer commits claros y pequeños.
6. Subir la rama a GitHub.
7. Abrir Pull Request hacia `develop`.
8. Revisar y hacer merge.
9. Probar el cambio en staging.
10. Si staging pasa, abrir Pull Request de `develop` hacia `main`.
11. Hacer merge a `main` para promover a demo / produccion academica.

### Ejemplo

```bash
git checkout develop
git pull
git checkout -b fix/cart-idor
```

## Promocion A Demo

Cuando staging funciona correctamente, se promueve `develop` hacia `main` mediante Pull Request.

```bash
git checkout develop
git pull
git checkout main
git pull
```

Luego se abre un Pull Request de `develop` hacia `main`.

El merge a `main` representa la version estable que puede desplegarse en el ambiente demo / produccion academica.
