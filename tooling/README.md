# Tooling

Esta carpeta contiene scripts y utilidades auxiliares del proyecto.

No contiene lógica de negocio del sistema, sino herramientas de soporte para trabajo local, validación y entorno de contratos.

## Scripts principales

### `contracts-docker.sh`
Script principal para trabajar contratos usando Docker CLI.

Comandos soportados:
- `build-image`
- `check-toolchain`
- `build`
- `test`
- `shell`

Ejemplo:
```bash
bash tooling/contracts-docker.sh build
bash tooling/contracts-docker.sh test