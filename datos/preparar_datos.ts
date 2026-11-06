/**
 * preparar_datos.ts
 *
 * Ubica los hospitales y los distritos sobre la red vial y escribe los
 * archivos que carga el navegador. Se ejecuta despues de construir_red.py.
 *
 *   node datos/preparar_datos.ts
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { leerRed, verticeMasCercano } from '../src/core/red.ts'

interface HospitalOsm {
  osm: string
  lon: number
  lat: number
}

const red = leerRed(toArrayBuffer(readFileSync('public/datos/red.bin')))
const osm: HospitalOsm[] = JSON.parse(readFileSync('datos/crudo/hospitales_osm.json', 'utf8'))
const catalogo = JSON.parse(readFileSync('datos/hospitales.json', 'utf8'))
const distritos = JSON.parse(readFileSync('datos/distritos.json', 'utf8'))

const porId = new Map(osm.map((h) => [h.osm, h]))

const hospitales = catalogo.hospitales.map((h: { osm: string; id: string }) => {
  const ubicacion = porId.get(h.osm)
  if (!ubicacion) {
    throw new Error(`El hospital ${h.id} (${h.osm}) no esta en el extracto de OSM.`)
  }
  return {
    ...h,
    lon: ubicacion.lon,
    lat: ubicacion.lat,
    vertice: verticeMasCercano(red, ubicacion.lon, ubicacion.lat)
  }
})

const zonas = distritos.distritos.map((d: { lon: number; lat: number }) => ({
  ...d,
  vertice: verticeMasCercano(red, d.lon, d.lat)
}))

writeFileSync(
  'public/datos/hospitales.json',
  JSON.stringify({ fuente: catalogo.fuente, alcance: catalogo.alcance, hospitales }, null, 1)
)
writeFileSync(
  'public/datos/distritos.json',
  JSON.stringify({ fuente: distritos.fuente, distritos: zonas }, null, 1)
)

console.log(`hospitales: ${hospitales.length}, distritos: ${zonas.length}`)

function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
