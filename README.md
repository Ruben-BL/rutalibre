# RutaLibre 🏍️

**Rutas en moto que se abren en Google Maps con un toque.** Libre, gratis y sin registro.

👉 **https://ruben-bl.github.io/rutalibre/**

Diseñas una ruta en gpx.studio o encuentras una buenísima en Wikiloc… y luego no hay forma de seguirla bien. El navegador reproduce la línea, pero si te pasas una salida no te reconduce. RutaLibre lo soluciona: convierte cualquier ruta en un enlace de **Google Maps** que la sigue, recalcula si te equivocas y te avisa de los radares. Y si no tienes ruta, te inventa una.

---

## Qué puedes hacer

### 🎲 Ruta sorpresa
¿Te apetece salir a dar una vuelta y no sabes por dónde? Dile cuántos kilómetros quieres (50, 75, 100, 150…) y hacia dónde, y te genera una vuelta **por carretera** desde donde estés.
- Con **«Muchas curvas» 🌀** busca las carreteras más reviradas de la zona y hace pasar la vuelta por ellas.
- Nada de pistas ni caminos de tierra, ni desvíos de ida y vuelta.
- Km reales, calculados sobre carretera.
- ¿No te convence? **«Otra ruta»** te genera otra distinta.

### 🗺️ Desde un GPX
Sube una ruta de **Wikiloc, gpx.studio** o cualquier otra app. RutaLibre la prepara para Google Maps y te dice **qué % coincide con tu ruta original**. En el mapa ves las dos: la tuya en rojo y la del navegador en azul.

### 👥 Comunidad
Rutas compartidas por otros moteros, **las más cercanas a ti primero**. Las abres con un toque. ¿Tienes una que merece la pena? Pulsa «Proponer una ruta».

### 💾 Mis rutas
Guarda tus rutas ya preparadas. El día de la salida, **«Abrir en Maps»** y a rodar, sin esperar a que se calcule nada.

### Y además
- **Arrastra los puntos** en el mapa para pasar por donde tú quieras: la ruta se recalcula sola.
- **Evitar autopistas y peajes.**
- **Lista de pueblos** por los que pasa la ruta, para meterla a mano en el navegador de tu moto (StreetCross, etc.).
- **Descarga en GPX**, para navegadores que solo importan tracks.

---

## Cómo se usa

1. Abre la web en el móvil y deja que use tu ubicación.
2. Genera una **ruta sorpresa** o sube tu **GPX**.
3. Mira la ruta en el mapa y, si quieres, arrastra algún punto.
4. Pulsa **«Abrir en Google Maps»**. Se abre la navegación con todo puesto. A disfrutar.

**Instálala como una app:** en Chrome, menú ⋮ → *Añadir a pantalla de inicio* (o *Instalar aplicación*).

> 💡 Prepara la ruta **antes de arrancar**. Nunca toques el móvil en marcha.

---

## Bueno saber

- **Google Maps admite como máximo 10 puntos por enlace.** En rutas muy largas (200 km o más) puede elegir alguna carretera distinta a la tuya. Echa un vistazo en Maps antes de salir. En *Opciones avanzadas* puedes partir la ruta en 2 o 3 tramos para más precisión.
- **Preparar una ruta tarda unos segundos** (hasta ~20 en rutas largas). Los servidores gratuitos que la calculan piden ir con calma.
- **En el ordenador la ubicación es aproximada**, porque no tiene GPS: toca el mapa en tu sitio para fijar la salida. En el móvil va fina.
- **Privacidad:** sin cuentas, sin registro y sin cookies de seguimiento. Tus rutas guardadas se quedan en tu móvil.

---

## Comparte tu ruta

En la pestaña **Comunidad → «Proponer una ruta»** (necesitas una cuenta gratuita de GitHub). Solo se publican rutas **tuyas** o con permiso de su autor, con licencia libre [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es). Ojo: las rutas de Wikiloc son de quien las grabó.

¿Has encontrado un fallo o tienes una idea? Abre una [*issue*](../../issues) en este repositorio.

---

## 🤓 Para frikis: cómo funciona por dentro

### Arquitectura
RutaLibre es **una web estática**: HTML, CSS y JavaScript sin servidor propio, publicada en GitHub Pages. Todo el cálculo se hace **en el navegador**, que consulta servicios libres basados en [OpenStreetMap](https://www.openstreetmap.org):

| Servicio | Para qué |
|---|---|
| [Valhalla](https://valhalla.github.io/valhalla/) (servidor público de [FOSSGIS](https://fossgis.de)) | Calcular rutas en moto y ajustar puntos a la carretera |
| [Overpass API](https://overpass-api.de) | Descargar las carreteras de la zona para medir curvas |
| [Nominatim](https://nominatim.org) | Saber en qué pueblo cae cada punto |
| [OpenFreeMap](https://openfreemap.org) + [MapLibre GL JS](https://maplibre.org) | El mapa |

Valhalla y Nominatim piden **1 petición por segundo** como máximo. Por eso todas las peticiones pasan por una cola (`js/router.js`), que además reintenta si el servidor está saturado y parte en trozos las rutas con muchos puntos.

### El problema de fondo
Google Maps no importa GPX: solo acepta **enlaces con hasta 10 puntos** (9 paradas + destino). Si le das pocos puntos, entre uno y otro elige el camino más rápido, que no tiene por qué ser el tuyo. El juego consiste en **elegir los 10 puntos que obligan al navegador a seguir tu ruta**.

### GPX → Google Maps (`js/planner.js`)
1. Se simplifica el track con **Douglas-Peucker** y se ponen 5 puntos en la **mitad de los tramos entre giros**, para "clavar" la carretera y no caer dentro de un pueblo.
2. Se calcula la ruta con Valhalla (perfil moto) y se **compara con el track**: se muestrea cada 150 m y se mide qué parte queda a menos de 150 m de la ruta. Eso es el **% de coincidencia**. Los tramos que no coinciden son "huecos".
3. Se añade un punto en el hueco más grande y se repite hasta usar los 10.
4. Con los 10 usados, se **intercambian puntos**: el que menos aporta (sus dos tramos ya coinciden y apenas se aparta de la recta entre sus vecinos) se cambia por uno en el hueco más grande. Si el cambio empeora, se deshace. Se queda con el mejor resultado.
5. Cada punto se ajusta a carretera con un filtro de clase de vía (nada de caminos de servicio ni parkings). Se detectan los **"pinchos"** (paradas a las que hay que ir y volver por el mismo camino) y se mueven.

*Probado: poner el punto justo tras el cruce donde la ruta se separa daba peores resultados que ponerlo en la mitad del hueco.*

### Ruta sorpresa
- Se dibuja un círculo que pasa por tu ubicación, con un radio calculado para los km pedidos (las carreteras son ~35% más largas que la línea recta). Sobre él se reparten 8 puntos con algo de azar.
- Cada punto se ajusta a la carretera **terciaria o superior** más cercana. Los pinchos se corrigen moviendo la parada a la carretera por donde ya pasa la ruta.
- Se calculan los km reales y se **reescala** el círculo hasta acercarse a los km pedidos (máximo 3 intentos).

### Curvas (`js/curves.js`)
- Se descargan de Overpass las carreteras asfaltadas (primarias, secundarias y terciarias) y se unen los trozos de una misma carretera.
- Se mide la curvatura con el método del proyecto libre [curvature](https://roadcurvature.com) de Adam Franco: en cada vértice se calcula el **radio de la circunferencia** que pasa por tres puntos seguidos, y cada tramo suma su longitud multiplicada por un peso (radio < 30 m ×2; < 60 m ×1,6; < 100 m ×1,3; < 175 m ×1). Las rectas no suman.
- De cada carretera se busca la **ventana de ~6 km más revirada**. La vuelta se divide en 3–4 sectores, y en cada uno se elige el mejor tramo y se mete con **dos puntos** (al 20% y al 80%), para que lo recorras entero y en el sentido de la vuelta.

### Mis rutas y la app
- «Mis rutas» se guarda en `localStorage` (`js/saved.js`), con las geometrías reducidas para que quepan muchas.
- Es una **PWA**: tiene `manifest` y un *service worker* que va primero a la red y, sin conexión, usa la copia guardada de la app.

### Rutas de la comunidad
Viven en el propio repositorio: `rutas/index.json` y un `.gpx` por ruta. Sin base de datos. Las propuestas llegan como *issues* desde el formulario `.github/ISSUE_TEMPLATE/nueva-ruta.yml`, y se publican con:
```bash
python3 scripts/nueva_ruta.py ruta.gpx --nombre "Curvas de Rellinars" --zona "Vallès Occidental" --autor "Rubén"
git add rutas && git commit -m "Ruta: Curvas de Rellinars (cierra #12)" && git push
```

### Estructura
```
index.html              página
css/app.css             estilos
js/app.js               interfaz y mapa
js/geo.js               geometría pura: GPX, Douglas-Peucker, comparación ruta/track, enlaces de Maps
js/router.js            cliente de Valhalla (cola, reintentos, rutas por trozos)
js/planner.js           planificador: GPX y ruta sorpresa
js/curves.js            carreteras de OpenStreetMap y medida de curvas
js/saved.js             «Mis rutas»
rutas/                  rutas de la comunidad
scripts/nueva_ruta.py   añade una ruta a la comunidad
vendor/                 MapLibre GL JS (BSD-3)
sw.js, manifest         PWA
```

### Ejecutarla en local y usar tus propios servidores
```bash
python3 -m http.server 8000      # y abre http://localhost:8000
```
Si la abres con doble clic (`file://`), los módulos de JavaScript no cargan.

Parámetros de la URL (se recuerdan en el dispositivo; con `=default` vuelve al servidor público):
- `?router=https://tu-valhalla:8002`: tu propio servidor Valhalla.
- `?overpass=https://tu-overpass/api/interpreter`: tu propio Overpass.

### Contribuir
El código es libre: haz un *fork*, mejora lo que quieras y abre un *pull request*. Ideas que serían bienvenidas: mejor colocación de puntos, más perfiles de curvas o más navegadores de destino.

---

## Licencia

Código: [GPL-3.0](LICENSE). Puedes usarlo, copiarlo y mejorarlo, pero cualquier versión que se distribuya tiene que seguir siendo libre.
Rutas de la comunidad: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es).
Datos del mapa © [colaboradores de OpenStreetMap](https://www.openstreetmap.org/copyright).
