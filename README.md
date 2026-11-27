# Rumbo

Tus viajes, parada a parada. App web instalable (PWA) en https://santimaal.github.io/rumbo/.

## Pruebas

```bash
npm install
npm test
```

`npm test` lanza las pruebas de la lógica y las de la interfaz con Playwright. Para usar Edge en vez del navegador que descarga Playwright: `PW_CANAL=msedge npx playwright test`.

## Publicar una versión

1. Añade lo nuevo arriba del todo en `novedades.js`, con el número de versión siguiente.
2. Pon el mismo número en `CACHE` de `sw.js` (una prueba avisa si no coinciden).
3. Sube `main`: GitHub Pages la publica y la app avisa a quien la tenga abierta.

## Viajes compartidos (Supabase)

Los viajes compartidos se guardan en Supabase. La estructura de la base de datos está en `supabase/migrations/`.
La clave que lleva la app es la pública: solo deja usar las funciones `crear_viaje`, `leer_viaje` y `guardar_viaje`,
que piden el código de cada viaje; la tabla no se puede leer ni listar.

## Conector MCP para asistentes de IA

`supabase/functions/rumbo-mcp` es un servidor MCP que deja a un asistente de IA crear viajes, leerlos y añadirles
lugares, consejos o notas. Dirección:

```
https://centngtgakviminnkkva.supabase.co/functions/v1/rumbo-mcp
```

- **Claude (web o app):** Ajustes → Conectores → Añadir conector personalizado, con esa dirección.
- **Claude Code:** `claude mcp add --transport http rumbo https://centngtgakviminnkkva.supabase.co/functions/v1/rumbo-mcp`

Para desplegarlo se suben `index.ts` y una copia de `logica.js` de la raíz (en el repositorio, `logica.js` de la función solo la reexporta).
