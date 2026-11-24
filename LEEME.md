# FabianApp 1.1 — Libreta de campo geológica

App web instalable (PWA) para exploración: estaciones, datos estructurales medidos con
la brújula del teléfono, muestras con QA/QC, fotos, tracks GPS y mapas sin señal.
Todos los datos se guardan **solo en el teléfono** hasta que tú exportas.

## 1. Publicarla (una sola vez, gratis)

La app necesita una dirección **https** para que el navegador le dé GPS, brújula y modo offline.

**GitHub Pages (recomendado)**
1. Crea una cuenta en github.com y un repositorio nuevo, por ejemplo `fabianapp` (público).
2. «Add file → Upload files» y arrastra **todo el contenido** de esta carpeta
   (index.html, app.js, app.css, sw.js, manifest.webmanifest y las carpetas icons/ y vendor/).
3. Settings → Pages → Branch: `main` / carpeta `/ (root)` → Save.
4. En un minuto queda en `https://TU-USUARIO.github.io/fabianapp/`.

(Alternativa: Netlify o Cloudflare Pages, arrastrando la carpeta.)

## 2. Instalarla en el celular

1. Abre la dirección en **Chrome** (Android).
2. Menú ⋮ → **Instalar aplicación** (o «Agregar a pantalla principal»).
3. Abre FabianApp desde el ícono y acepta los permisos de **ubicación**.
4. Haz una prueba con señal: navega por tu zona de trabajo y usa el botón de la nube
   para **guardar la zona** (topográfico o satélite) antes de salir a campo.

## 3. Convertirla en APK (opcional)

1. Entra a **pwabuilder.com** y pega la dirección de tu app.
2. «Package for stores» → **Android** → descarga el paquete.
3. Dentro viene la APK firmada para instalar directamente (y el AAB por si algún día
   la subes a Play Store). Guarda bien el archivo de firma que trae el paquete.

## Uso rápido

- **Estación**: botón naranja del mapa. Toma la posición GPS; usa «Promediar GPS 15 s»
  para mejorar la precisión. También puedes escribir coordenadas en CTM12, UTM o MAGNA,
  o mantener presionado el mapa para crear una estación en ese punto.
- **Brújula**: apoya el dorso del teléfono sobre el plano (o el borde largo sobre la
  lineación), espera a que la estabilidad se ponga verde y toca «Capturar».
  Configura la **declinación magnética** en Más → Ajustes y compara de vez en cuando
  con tu Brunton.
- **Muestras**: códigos automáticos (M-0001…), tipos de muestreo y controles QA/QC
  (duplicado de campo, blanco, estándar MRC con su referencia).
- **Tracks**: graban con la pantalla encendida. Si bloqueas el teléfono, el navegador
  pausa el GPS.
- **Exportar** (Más): CSV de estaciones, estructuras y muestras (con WGS84, UTM y CTM12
  en cada fila, listos para Excel/Access), KML, GeoJSON y GPX.
- **Respaldo**: Más → «Crear respaldo completo». Hazlo al final de cada salida
  y guárdalo en Drive; se restaura con «Restaurar respaldo».

## Importar mapas y capas (Más → Capas importadas → Importar archivo)

- **PDF georreferenciado** (ISO 32000 / «GeoPDF» exportado desde ArcGIS, QGIS, GDAL o Avenza):
  se ubica solo sobre el mapa, recortado al marco (sin leyenda ni márgenes). Si viene en
  Datum Bogotá, se convierte a MAGNA/WGS84. Se usa la página 1.
- **PDF sin georreferencia o imagen (JPG/PNG)**: georreferéncialo a mano tocando 3 o más
  puntos de coordenadas conocidas (cruces de grilla, esquinas de plancha); con 4 o más
  te muestra el error medio cuadrático.
- **Shapefile**: un .zip con .shp, .dbf y .prj, o selecciona esos archivos juntos.
  Si falta el .prj, la app te pregunta el sistema (CTM12, MAGNA Bogotá/Este Central, UTM).
- **KML / KMZ, GPX y GeoJSON.**

Desde el botón de capas puedes prender/apagar cada una y ajustar la transparencia de los PDF.

## Sistemas de coordenadas

- Origen Nacional CTM12 — EPSG:9377 (oficial en Colombia, Resolución IGAC 471 de 2020)
- UTM WGS84 (zona automática)
- MAGNA-SIRGAS Bogotá (EPSG:3116) y Este Central (EPSG:3117)
- Geográficas WGS84 en grados decimales o G° M' S"

La altura del GPS es elipsoidal: escribe la ondulación del geoide (N) de tu zona en
Ajustes para ver alturas sobre el nivel del mar.

## Créditos

Leaflet 1.9.4 (BSD-2), proj4js 2.15 (MIT), shpjs 6.2 (MIT), PDF.js 3.11 (Apache-2.0). Teselas: OpenTopoMap, OpenStreetMap y Esri,
con sus atribuciones visibles en el mapa.
