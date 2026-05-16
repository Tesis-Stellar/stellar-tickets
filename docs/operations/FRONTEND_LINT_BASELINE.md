# Frontend Lint Baseline

## Alcance

Para la entrega se declara una linea base de deuda ESLint en frontend en lugar de reestructurar componentes grandes antes de la sustentacion.

## Estado Capturado

| Metrica | Valor |
| --- | ---: |
| Errores | 41 |
| Warnings | 11 |
| Archivos afectados | 18 |

## Reglas Principales

| Regla | Errores | Warnings |
| --- | ---: | ---: |
| `@typescript-eslint/no-explicit-any` | 38 | 0 |
| `@typescript-eslint/no-empty-object-type` | 2 | 0 |
| `@typescript-eslint/no-require-imports` | 1 | 0 |
| `react-refresh/only-export-components` | 0 | 8 |
| `react-hooks/exhaustive-deps` | 0 | 2 |
| `eslint/unknown` | 0 | 1 |

## Criterio Operativo

- `npm run lint` conserva el comportamiento estricto y muestra el detalle completo.
- `npm run lint:baseline` falla si la deuda aumenta por encima de la linea base declarada.
- Nuevos cambios deben reducir estos conteos o mantenerlos iguales; no se aceptan incrementos sin actualizar esta deuda de forma explicita.

## Deuda Recomendada

1. Tipar las respuestas de Freighter y API que hoy usan `any`.
2. Separar exports auxiliares de componentes shadcn/ui si se decide exigir Fast Refresh limpio.
3. Reemplazar el `require` del plugin de Tailwind por import ESM.
4. Revisar dependencias de hooks en `ConnectWallet` y `AdminDashboard`.
