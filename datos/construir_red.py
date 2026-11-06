"""
construir_red.py

Convierte el extracto de OpenStreetMap de Peru en la red vial dirigida de
Lima Metropolitana y el Callao que usa el sistema, en un formato binario
compacto que el navegador carga sin procesar.

Pasos:
  1. Lee las vias vehiculares dentro del recuadro de Lima.
  2. Construye el grafo: los vertices son intersecciones y extremos de via;
     cada tramo entre dos vertices es una arista con su geometria.
  3. Respeta el sentido de circulacion (oneway, rotondas).
  4. Conserva solo la componente fuertemente conexa mayor, para que todo
     punto pueda llegar a todo hospital.
  5. Registra, por tramo, que datos faltan (velocidad, carriles, superficie,
     nombre). El modelo procedural de tiempos usa ese registro.
  6. Extrae los hospitales de OSM dentro del recuadro.

Uso:
  datos/.venv/bin/python datos/construir_red.py datos/crudo/peru-latest.osm.pbf public/datos
"""

import json
import math
import os
import struct
import sys
import tempfile

import numpy as np
import osmium
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components

# Lima Metropolitana y Callao (sur, oeste, norte, este).
SUR, OESTE, NORTE, ESTE = -12.55, -77.22, -11.70, -76.70

# Clase de via -> codigo. El orden refleja la jerarquia vial.
CLASES = [
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
    'unclassified', 'residential', 'living_street',
    'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]
CODIGO_CLASE = {c: i for i, c in enumerate(CLASES)}

BLOQUEADO = {'no', 'private'}

# Bits de datos presentes en el tramo.
TIENE_VELOCIDAD = 1
TIENE_CARRILES = 2
TIENE_SUPERFICIE = 4
TIENE_NOMBRE = 8
SUPERFICIE_NO_PAVIMENTADA = 16

NO_PAVIMENTADAS = {'unpaved', 'dirt', 'ground', 'gravel', 'sand', 'earth', 'mud', 'compacted', 'fine_gravel'}


def dentro(lon, lat):
    return OESTE <= lon <= ESTE and SUR <= lat <= NORTE


def metros(lon1, lat1, lon2, lat2):
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def leer_velocidad(valor):
    if not valor:
        return 0
    texto = valor.split(';')[0].strip().lower().replace('km/h', '').strip()
    try:
        v = float(texto)
    except ValueError:
        return 0
    return int(v) if 5 <= v <= 130 else 0


def sentido(tags):
    """1: solo hacia adelante, -1: solo hacia atras, 0: doble sentido."""
    oneway = tags.get('oneway', '')
    if oneway in ('yes', 'true', '1'):
        return 1
    if oneway == '-1':
        return -1
    if oneway == 'no':
        return 0
    if tags.get('junction') in ('roundabout', 'circular'):
        return 1
    if tags.get('highway') in ('motorway', 'motorway_link'):
        return 1
    return 0


def leer_osm(ruta_pbf):
    vias = []          # (refs, coords, clase, sentido, banderas, velocidad, nombre)
    hospitales = []

    indice = tempfile.NamedTemporaryFile(prefix='nodos-', suffix='.idx', delete=False)
    indice.close()
    try:
        procesador = (
            osmium.FileProcessor(ruta_pbf)
            .with_locations('sparse_file_array,' + indice.name)
        )
        for obj in procesador:
            tags = obj.tags
            if obj.is_node():
                if tags.get('amenity') == 'hospital' or tags.get('healthcare') == 'hospital':
                    lon, lat = obj.location.lon, obj.location.lat
                    if dentro(lon, lat):
                        hospitales.append(ficha_hospital('n', obj.id, tags, lon, lat))
                continue
            if not obj.is_way():
                continue

            if tags.get('amenity') == 'hospital' or tags.get('healthcare') == 'hospital':
                puntos = [(n.lon, n.lat) for n in obj.nodes if n.location.valid()]
                if puntos:
                    lon = sum(p[0] for p in puntos) / len(puntos)
                    lat = sum(p[1] for p in puntos) / len(puntos)
                    if dentro(lon, lat):
                        hospitales.append(ficha_hospital('w', obj.id, tags, lon, lat))

            clase = tags.get('highway')
            if clase not in CODIGO_CLASE:
                continue
            if tags.get('access') in BLOQUEADO or tags.get('motor_vehicle') in BLOQUEADO:
                continue
            if tags.get('area') == 'yes':
                continue

            refs, coords = [], []
            alguno_dentro = False
            for n in obj.nodes:
                if not n.location.valid():
                    continue
                lon, lat = n.location.lon, n.location.lat
                refs.append(n.ref)
                coords.append((lon, lat))
                if dentro(lon, lat):
                    alguno_dentro = True
            if not alguno_dentro or len(refs) < 2:
                continue

            banderas = 0
            velocidad = leer_velocidad(tags.get('maxspeed'))
            if velocidad:
                banderas |= TIENE_VELOCIDAD
            if tags.get('lanes'):
                banderas |= TIENE_CARRILES
            superficie = tags.get('surface')
            if superficie:
                banderas |= TIENE_SUPERFICIE
                if superficie in NO_PAVIMENTADAS:
                    banderas |= SUPERFICIE_NO_PAVIMENTADA
            if tags.get('name'):
                banderas |= TIENE_NOMBRE

            vias.append((refs, coords, CODIGO_CLASE[clase], sentido(tags),
                         banderas, velocidad, tags.get('name', '')))
    finally:
        os.unlink(indice.name)

    return vias, hospitales


def ficha_hospital(tipo, ident, tags, lon, lat):
    return {
        'osm': f'{tipo}{ident}',
        'nombre': tags.get('name', ''),
        'operador': tags.get('operator', ''),
        'emergencia': tags.get('emergency', ''),
        'camas': tags.get('beds', ''),
        'lon': round(lon, 6),
        'lat': round(lat, 6),
    }


def construir_grafo(vias):
    # Un nodo OSM es vertice del grafo si es extremo de una via o lo comparten varias.
    uso = {}
    for refs, *_ in vias:
        for r in refs:
            uso[r] = uso.get(r, 0) + 1
    es_vertice = set(r for r, c in uso.items() if c > 1)
    for refs, *_ in vias:
        es_vertice.add(refs[0])
        es_vertice.add(refs[-1])

    indice = {}
    lon_v, lat_v = [], []

    def vertice(ref, lon, lat):
        i = indice.get(ref)
        if i is None:
            i = len(lon_v)
            indice[ref] = i
            lon_v.append(lon)
            lat_v.append(lat)
        return i

    # Tramos no dirigidos con geometria propia; las aristas dirigidas los referencian.
    tramos = []   # (a, b, longitud, clase, banderas, velocidad, geometria, sentido, nombre_id)
    nombres = {'': 0}
    lista_nombres = ['']

    for refs, coords, clase, sent, banderas, velocidad, nombre in vias:
        if nombre not in nombres:
            nombres[nombre] = len(lista_nombres)
            lista_nombres.append(nombre)
        nid = nombres[nombre]

        inicio = 0
        for k in range(1, len(refs)):
            if refs[k] in es_vertice or k == len(refs) - 1:
                tramo = coords[inicio:k + 1]
                if refs[inicio] != refs[k] and len(tramo) >= 2:
                    largo = sum(metros(*tramo[t], *tramo[t + 1]) for t in range(len(tramo) - 1))
                    a = vertice(refs[inicio], *coords[inicio])
                    b = vertice(refs[k], *coords[k])
                    if largo > 0:
                        tramos.append((a, b, largo, clase, banderas, velocidad, tramo, sent, nid))
                inicio = k

    return np.array(lon_v), np.array(lat_v), tramos, lista_nombres


def aristas_dirigidas(tramos):
    """Cada arista es (origen, destino, indice_tramo, invertida)."""
    aristas = []
    for t, (a, b, *_resto) in enumerate(tramos):
        sent = tramos[t][7]
        if sent >= 0:
            aristas.append((a, b, t, 0))
        if sent <= 0:
            aristas.append((b, a, t, 1))
    return aristas


def componente_mayor(n, aristas):
    filas = np.fromiter((e[0] for e in aristas), dtype=np.int64, count=len(aristas))
    cols = np.fromiter((e[1] for e in aristas), dtype=np.int64, count=len(aristas))
    m = csr_matrix((np.ones(len(aristas), dtype=np.int8), (filas, cols)), shape=(n, n))
    _, etiquetas = connected_components(m, directed=True, connection='strong')
    mayor = np.bincount(etiquetas).argmax()
    return etiquetas == mayor


def escribir(destino, lon_v, lat_v, tramos, aristas, nombres, conservar):
    # Reindexacion: solo vertices de la componente mayor.
    nuevo = -np.ones(len(lon_v), dtype=np.int64)
    nuevo[conservar] = np.arange(conservar.sum())
    n = int(conservar.sum())

    aristas = [e for e in aristas if conservar[e[0]] and conservar[e[1]]]
    usados = sorted(set(e[2] for e in aristas))
    tramo_nuevo = {t: i for i, t in enumerate(usados)}

    # CSR por vertice de origen.
    aristas.sort(key=lambda e: (nuevo[e[0]], nuevo[e[1]]))
    m = len(aristas)
    desplaz = np.zeros(n + 1, dtype=np.int32)
    destino_a = np.zeros(m, dtype=np.int32)
    tramo_a = np.zeros(m, dtype=np.int32)
    for k, (a, b, t, inv) in enumerate(aristas):
        desplaz[nuevo[a] + 1] += 1
        destino_a[k] = nuevo[b]
        # El bit alto marca que la arista recorre el tramo al reves.
        tramo_a[k] = tramo_nuevo[t] | (inv << 30)
    desplaz = np.cumsum(desplaz).astype(np.int32)

    s = len(usados)
    largo = np.zeros(s, dtype=np.float32)
    clase = np.zeros(s, dtype=np.uint8)
    banderas = np.zeros(s, dtype=np.uint8)
    velocidad = np.zeros(s, dtype=np.uint8)
    nombre = np.zeros(s, dtype=np.int32)
    geo_desplaz = np.zeros(s + 1, dtype=np.int32)
    geo = []
    for i, t in enumerate(usados):
        a, b, lg, cl, bd, vel, tramo, _sent, nid = tramos[t]
        largo[i], clase[i], banderas[i], velocidad[i], nombre[i] = lg, cl, bd, vel, nid
        geo.extend(tramo)
        geo_desplaz[i + 1] = len(geo)
    geo = np.array(geo, dtype=np.float64)

    # Coordenadas relativas al origen del recuadro, en Float32, para precision submetrica.
    base = np.array([OESTE, SUR])
    vert = np.stack([lon_v[conservar], lat_v[conservar]], axis=1) - base
    geo_rel = geo - base

    os.makedirs(destino, exist_ok=True)
    partes = [
        ('vertices', vert.astype(np.float32)),
        ('desplazamientos', desplaz),
        ('destinos', destino_a),
        ('tramos', tramo_a),
        ('largo', largo),
        ('clase', clase),
        ('banderas', banderas),
        ('velocidad', velocidad),
        ('nombre', nombre),
        ('geoDesplazamientos', geo_desplaz),
        ('geometria', geo_rel.astype(np.float32)),
    ]

    cabecera = {'version': 1, 'base': [OESTE, SUR], 'vertices': n, 'aristas': m,
                'tramos': s, 'clases': CLASES, 'partes': []}
    cuerpo = bytearray()
    for nombre_parte, arr in partes:
        while len(cuerpo) % 8:
            cuerpo.append(0)
        datos = np.ascontiguousarray(arr).tobytes()
        cabecera['partes'].append({'nombre': nombre_parte, 'tipo': str(arr.dtype),
                                   'inicio': len(cuerpo), 'largo': int(arr.size)})
        cuerpo.extend(datos)

    texto = json.dumps(cabecera, separators=(',', ':')).encode()
    relleno = (-(8 + len(texto))) % 8
    texto += b' ' * relleno
    with open(os.path.join(destino, 'red.bin'), 'wb') as f:
        f.write(b'RVL1')
        f.write(struct.pack('<I', len(texto)))
        f.write(texto)
        f.write(cuerpo)

    # Nombres de via: solo los usados, para mostrar la ruta en lenguaje humano.
    with open(os.path.join(destino, 'nombres.json'), 'w', encoding='utf-8') as f:
        json.dump(nombres, f, ensure_ascii=False, separators=(',', ':'))

    return n, m, s, len(geo)


def main():
    pbf, destino = sys.argv[1], sys.argv[2]
    vias, hospitales = leer_osm(pbf)
    print(f'vias leidas: {len(vias)}, hospitales OSM: {len(hospitales)}')

    lon_v, lat_v, tramos, nombres = construir_grafo(vias)
    del vias
    aristas = aristas_dirigidas(tramos)
    print(f'vertices: {len(lon_v)}, tramos: {len(tramos)}, aristas dirigidas: {len(aristas)}')

    conservar = componente_mayor(len(lon_v), aristas)
    print(f'componente fuertemente conexa mayor: {conservar.sum()} vertices '
          f'({100 * conservar.mean():.1f} %)')

    n, m, s, g = escribir(destino, lon_v, lat_v, tramos, aristas, nombres, conservar)
    print(f'escrito: {n} vertices, {m} aristas, {s} tramos, {g} puntos de geometria')

    os.makedirs('datos/crudo', exist_ok=True)
    with open('datos/crudo/hospitales_osm.json', 'w', encoding='utf-8') as f:
        json.dump(hospitales, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
