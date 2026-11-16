# RutaLibre 🏍️

**Rutas en moto que se abren en Google Maps con un toque.** Libre, gratis y sin registro.

Las apps para diseñar rutas (Wikiloc, gpx.studio…) y las que navegan bien (Google Maps, el navegador de la moto) no se entienden entre ellas. Google Maps no sigue una línea dibujada: va de punto en punto. RutaLibre elige esos puntos por ti para que Maps siga tu ruta, y si te pasas una salida, recalcula hacia el siguiente punto y te avisa de los radares.

## Qué hace

- **Ruta sorpresa.** Eliges kilómetros (50, 75, 100, 150 u otra cifra) y dirección, y te genera una vuelta **por carretera** desde donde estés: los puntos caen siempre en carreteras (nada de pistas ni caminos), se evitan los desvíos de ida y vuelta, y los km son reales. La ves en el mapa, puedes arrastrar los puntos y la abres en Google Maps con un único enlace.
- **Desde un GPX.** Subes un archivo de Wikiloc, gpx.studio o similar. RutaLibre calcula por dónde iría el navegador, lo compara con tu track y coloca los puntos de paso justo donde se separan (hasta 10 por enlace, el máximo de Google Maps). Te muestra el **% de coincidencia** y las dos líneas en el mapa: la roja es tu ruta y la azul, la del navegador.
- **Lista de pueblos.** Te dice por qué pueblos pasa la ruta, en orden. Sirve para meterla a mano en StreetCross u otros navegadores de moto, o para usar los nombres en el enlace de Maps.
- **Descargas.** El track en `.gpx` (para navegadores que solo importan tracks) y los puntos de paso en `.gpx`.
- **Se instala como una app** en el móvil: Chrome → menú ⋮ → *Añadir a pantalla de inicio*.

## Limitaciones

- Google Maps admite como máximo **10 puntos por enlace**. Las rutas largas o con bucles pueden necesitar 2 enlaces para una coincidencia alta.
- Los cálculos se hacen con [Valhalla](https://valhalla.github.io/valhalla/) sobre OpenStreetMap. Google puede elegir alguna carretera distinta, así que conviene echar un vistazo en Maps antes de salir.
- Si el motor de rutas no responde, la página sigue funcionando en modo aproximado (como en la fase 1) y te avisa.
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

## Motor de rutas

Por defecto se usa el servidor público de Valhalla de [FOSSGIS](https://fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/), que pide **como máximo 1 petición por segundo**. RutaLibre respeta ese límite, por eso ajustar una ruta tarda unos segundos.

Para usar tu propio servidor (por ejemplo, en un Proxmox de casa), abre la web con `?router=https://tu-servidor:8002`. Se recuerda en ese dispositivo; `?router=default` vuelve al público.

## Estructura

```
index.html            página
css/app.css           estilos
js/geo.js             geometría (sin dependencias): GPX, simplificación, comparación ruta/track, enlaces
js/router.js          cliente de Valhalla (cola de 1 petición/segundo)
js/planner.js         planificador: ruta sorpresa por carretera y GPX con % de coincidencia
js/app.js             interfaz y mapa
vendor/               MapLibre GL JS (librería del mapa, licencia BSD-3)
sw.js, manifest...    para instalarla como app
```

## Tecnología y créditos

- Mapa: [MapLibre GL JS](https://maplibre.org) + teselas de [OpenFreeMap](https://openfreemap.org), con datos © [colaboradores de OpenStreetMap](https://www.openstreetmap.org/copyright).
- Rutas: [Valhalla](https://valhalla.github.io/valhalla/) (servidor público de FOSSGIS).
- Nombres de pueblos: [Nominatim](https://nominatim.org), con un máximo de 1 petición por segundo, según su política de uso.
- Sin servidor propio, sin cookies de seguimiento y sin cuentas. Tus rutas no se guardan en ningún sitio. Solo salen de tu móvil las coordenadas que se envían al motor de rutas para calcularlas, a Nominatim si pides la lista de pueblos, y las que van en el enlace de Google Maps.

## Hoja de ruta

- **Fase 1 ✅** mapa, ruta sorpresa, GPX → Google Maps, lista de pueblos, descargas.
- **Fase 2 ✅** motor de rutas (Valhalla): puntos sobre carreteras reales, sin desvíos de ida y vuelta, km reales y % de coincidencia con tu track.
- **Fase 3:** preferencia por carreteras de curvas y rutas compartidas por la comunidad.

## Licencia

[GPL-3.0](LICENSE). Puedes usarla, copiarla y mejorarla, pero cualquier versión que se distribuya tiene que seguir siendo libre.
