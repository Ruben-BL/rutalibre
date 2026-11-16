# RutaLibre 🏍️

**Rutas en moto que se abren en Google Maps con un toque.** Libre, gratis y sin registro.

Las apps para diseñar rutas (Wikiloc, gpx.studio…) y las que navegan bien (Google Maps, el navegador de la moto) no se entienden entre ellas. Google Maps no sigue una línea dibujada: va de punto en punto. RutaLibre elige esos puntos por ti para que Maps siga tu ruta, y si te pasas una salida, recalcula hacia el siguiente punto y te avisa de los radares.

## Qué hace

- **Ruta sorpresa.** Eliges kilómetros (50, 75, 100, 150 u otra cifra) y dirección, y te genera una vuelta desde donde estés. La ves en el mapa, puedes arrastrar los puntos y la abres en Google Maps con un único enlace.
- **Desde un GPX.** Subes un archivo de Wikiloc, gpx.studio o similar. RutaLibre elige los mejores puntos de paso (hasta 10 por enlace, el máximo de Google Maps) y te da el enlace.
- **Lista de pueblos.** Te dice por qué pueblos pasa la ruta, en orden. Sirve para meterla a mano en StreetCross u otros navegadores de moto, o para usar los nombres en el enlace de Maps.
- **Descargas.** El track en `.gpx` (para navegadores que solo importan tracks) y los puntos de paso en `.gpx`.
- **Se instala como una app** en el móvil: Chrome → menú ⋮ → *Añadir a pantalla de inicio*.

## Limitaciones (fase 1)

- Google Maps admite como máximo **10 puntos por enlace**. Las rutas largas o con bucles pueden necesitar 2 enlaces, o arrastrar algún punto.
- En la ruta sorpresa **los km son aproximados**: los puntos se reparten en círculo y Google elige las carreteras entre ellos. La distancia exacta te la da Maps antes de arrancar.
- Todavía no busca carreteras de curvas. Está previsto para la fase 3.

## Publicarla gratis en GitHub Pages

1. Crea un repositorio público en GitHub (por ejemplo `rutalibre`).
2. Sube **todo el contenido de esta carpeta**: *Add file → Upload files*, arrastra los archivos y las carpetas, y pulsa *Commit changes*.
3. Ve a *Settings → Pages → Source: Deploy from a branch*, elige la rama `main` y la carpeta `/ (root)`, y guarda.
4. En 1–2 minutos estará en `https://TU-USUARIO.github.io/rutalibre/`.

Hace falta HTTPS (GitHub Pages ya lo da) para que el navegador permita usar tu ubicación.

### Probarla en tu ordenador

```bash
python3 -m http.server 8000
```

Y abre `http://localhost:8000`. Si la abres con doble clic (`file://`), los módulos de JavaScript no cargan.

## Estructura

```
index.html            página
css/app.css           estilos
js/geo.js             lógica de rutas (sin dependencias): GPX, selección de puntos, ruta sorpresa, enlaces
js/app.js             interfaz y mapa
vendor/               MapLibre GL JS (librería del mapa, licencia BSD-3)
sw.js, manifest...    para instalarla como app
```

## Tecnología y créditos

- Mapa: [MapLibre GL JS](https://maplibre.org) + teselas de [OpenFreeMap](https://openfreemap.org), con datos © [colaboradores de OpenStreetMap](https://www.openstreetmap.org/copyright).
- Nombres de pueblos: [Nominatim](https://nominatim.org), con un máximo de 1 petición por segundo, según su política de uso.
- Sin servidor propio, sin cookies de seguimiento y sin cuentas. Tus rutas no salen de tu móvil, salvo las coordenadas que se envían a Nominatim al pedir la lista de pueblos y las que van en el enlace de Google Maps.

## Hoja de ruta

- **Fase 1 (esta):** mapa, ruta sorpresa, GPX → Google Maps, lista de pueblos, descargas.
- **Fase 2:** motor de rutas propio (Valhalla): puntos ajustados a carreteras reales, km exactos y comprobación de que la ruta de Maps coincide con la tuya.
- **Fase 3:** preferencia por carreteras de curvas y rutas compartidas por la comunidad.

## Licencia

[GPL-3.0](LICENSE). Puedes usarla, copiarla y mejorarla, pero cualquier versión que se distribuya tiene que seguir siendo libre.
