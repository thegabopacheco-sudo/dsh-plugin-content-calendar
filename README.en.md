# dsh-plugin-content-calendar — Content Calendar

Calendario de contenido para DeepSeek Harness: programar anuncios y cross-posts, ver pendientes y marcar publicaciones como hechas, con almacenamiento local y confirmación.

## Herramientas

Ver `docs/HOW-IT-WORKS.md` para el detalle.

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-content-calendar` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-content-calendar
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_CONTENT_CALENDAR_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\content-calendar\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
