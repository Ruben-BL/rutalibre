#!/usr/bin/env python3
"""
Añade una ruta a «Rutas de la comunidad» (rutas/index.json).

Uso (desde la carpeta del repositorio):
    python3 scripts/nueva_ruta.py ruta.gpx --nombre "Curvas de Rellinars" --zona "Vallès" \
        --autor "Rubén" --descripcion "Asfalto bueno, parada en Mura"

Qué hace:
  1. Copia el .gpx a rutas/<id>.gpx (el id sale del nombre: "curvas-de-rellinars").
  2. Calcula los km y el punto de salida.
  3. Añade (o actualiza, si ya existe ese id) la entrada en rutas/index.json.
Después solo queda: git add rutas && git commit -m "Ruta: ..." && git push
Solo usa la librería estándar de Python.
"""
import argparse, json, math, os, re, shutil, sys, unicodedata
import xml.etree.ElementTree as ET

def slug(t):
    t = unicodedata.normalize('NFD', t).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', t.lower()).strip('-')[:50] or 'ruta'

def hav(a, b):
    r = math.pi / 180
    h = math.sin((b[0]-a[0])*r/2)**2 + math.cos(a[0]*r)*math.cos(b[0]*r)*math.sin((b[1]-a[1])*r/2)**2
    return 2 * 6371000 * math.asin(math.sqrt(h))

def main():
    ap = argparse.ArgumentParser(description='Añade una ruta a rutas/index.json')
    ap.add_argument('gpx'); ap.add_argument('--nombre', required=True); ap.add_argument('--zona', required=True)
    ap.add_argument('--autor', default=''); ap.add_argument('--descripcion', default='')
    a = ap.parse_args()

    root = ET.parse(a.gpx).getroot()
    pts = [(float(p.get('lat')), float(p.get('lon'))) for p in root.iter() if p.tag.endswith('trkpt') or p.tag.endswith('rtept')]
    if len(pts) < 2: sys.exit('El GPX no tiene track ni ruta.')
    km = sum(hav(pts[i-1], pts[i]) for i in range(1, len(pts))) / 1000

    rid = slug(a.nombre)
    os.makedirs('rutas', exist_ok=True)
    dest = f'rutas/{rid}.gpx'
    if os.path.abspath(a.gpx) != os.path.abspath(dest): shutil.copyfile(a.gpx, dest)

    idx_path = 'rutas/index.json'
    data = json.load(open(idx_path, encoding='utf-8')) if os.path.exists(idx_path) else []
    entry = {'id': rid, 'nombre': a.nombre, 'zona': a.zona, 'autor': a.autor, 'descripcion': a.descripcion,
             'km': round(km, 1), 'inicio': [round(pts[0][0], 5), round(pts[0][1], 5)], 'archivo': dest}
    data = [e for e in data if e.get('id') != rid] + [entry]
    data.sort(key=lambda e: e['nombre'].lower())
    with open(idx_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2); f.write('\n')
    print(f"✔ {a.nombre}: {km:.1f} km → {dest}  ({len(data)} rutas en total)")

if __name__ == '__main__':
    main()
