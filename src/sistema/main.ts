/**
 * main.ts (sistema)
 *
 * Orquestacion del sistema de despacho: carga de datos, mapa, escenario,
 * ocupacion de los hospitales y la secuencia visual de cada despacho:
 *
 *   1. la onda de Dijkstra se expande por las calles reales,
 *   2. los hospitales se encienden cuando la onda los alcanza,
 *   3. se traza la ruta elegida y, en gris, la del hospital mas cercano,
 *   4. la ambulancia recorre la ruta y aparece la tarjeta con la decision.
 */

import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import { ESCENARIO_BASE, type Escenario, perfilTrafico } from '../core/costos.ts'
import { type Hospital, type TipoEmergencia, OCUPACION_SATURADA, esperaEstimada } from '../core/despacho.ts'
import { BIT_INVERTIDA, MASCARA_TRAMO, type RedVial, leerRed } from '../core/red.ts'
import { ocupacionFondo } from '../core/ocupacion.ts'
import { CapaOnda } from './capaOnda.ts'
import { Motor } from './motor.ts'
import type { RespuestaDespacho } from './trabajador.ts'
import { iniciarSimulacion } from './simulacionVista.ts'
import { agregarSumidero, simetrizar, vecindadRelativa } from '../core/reduccion.ts'

interface HospitalDatos extends Hospital {
  categoria: string
}

const TIPOS: { clave: TipoEmergencia; nombre: string }[] = [
  { clave: 'trauma', nombre: 'Trauma' },
  { clave: 'cardiaca', nombre: 'Cardíaca' },
  { clave: 'respiratoria', nombre: 'Respiratoria' },
  { clave: 'obstetrica', nombre: 'Obstétrica' },
  { clave: 'pediatrica', nombre: 'Pediátrica' },
  { clave: 'general', nombre: 'General' }
]

const ESTILO_MAPA = 'https://tiles.openfreemap.org/styles/dark'
const DURACION_ONDA = 3600
const DURACION_AMBULANCIA = 2600

const estado = {
  red: null as RedVial | null,
  nombres: [] as string[],
  hospitales: [] as HospitalDatos[],
  escenario: { ...ESCENARIO_BASE } as Escenario,
  tipo: 'trauma' as TipoEmergencia,
  /** Ocupacion fijada a mano por el usuario, por indice de hospital. */
  manual: new Map<number, number>(),
  ocupado: false,
  ultimo: null as { lon: number; lat: number } | null,
  distritos: [] as { nombre: string; lon: number; lat: number; vertice: number }[],
  despacho: null as { r: RespuestaDespacho; valores: number[] } | null
}

const $ = <T extends HTMLElement>(id: string): T => {
  const e = document.getElementById(id)
  if (!e) throw new Error('Falta #' + id)
  return e as T
}

const mapa = new maplibregl.Map({
  container: 'mapa',
  style: ESTILO_MAPA,
  center: [-77.035, -12.04],
  zoom: 10.4,
  minZoom: 9,
  maxBounds: [
    [-77.6, -12.75],
    [-76.4, -11.5]
  ],
  attributionControl: { compact: true }
})
mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

const motor = new Motor()
let capa: CapaOnda | null = null
let marcadorEmergencia: maplibregl.Marker | null = null
let marcadorAmbulancia: maplibregl.Marker | null = null

// ---------------------------------------------------------------- carga

async function descargar(url: string, alAvanzar: (f: number) => void): Promise<ArrayBuffer> {
  const respuesta = await fetch(url)
  if (!respuesta.ok || !respuesta.body) {
    throw new Error('No se pudo descargar ' + url)
  }
  const total = Number(respuesta.headers.get('content-length')) || 0
  const lector = respuesta.body.getReader()
  const partes: Uint8Array[] = []
  let recibido = 0
  while (true) {
    const { done, value } = await lector.read()
    if (done) break
    partes.push(value)
    recibido += value.length
    if (total) alAvanzar(recibido / total)
  }
  const salida = new Uint8Array(recibido)
  let p = 0
  for (const parte of partes) {
    salida.set(parte, p)
    p += parte.length
  }
  return salida.buffer
}

async function cargar(): Promise<void> {
  const barra = $('cargaBarra')
  const detalle = $('cargaDetalle')
  const [buffer, hospitales, nombres, distritos] = await Promise.all([
    descargar('./datos/red.bin', (f) => (barra.style.width = `${Math.round(f * 80)}%`)),
    fetch('./datos/hospitales.json').then((r) => r.json()),
    fetch('./datos/nombres.json').then((r) => r.json()),
    fetch('./datos/distritos.json').then((r) => r.json())
  ])
  estado.hospitales = hospitales.hospitales
  estado.nombres = nombres
  estado.distritos = distritos.distritos

  detalle.textContent = 'Construyendo el grafo dirigido y la red inversa…'
  barra.style.width = '85%'
  await motor.iniciar(buffer.slice(0), estado.hospitales)
  await motor.escenario(estado.escenario)

  estado.red = leerRed(buffer)
  detalle.textContent = 'Subiendo la geometría de las calles a la GPU…'
  barra.style.width = '95%'
  await new Promise((r) => requestAnimationFrame(r))
  capa = new CapaOnda(estado.red)

  $('estadoRed').textContent =
    `Lima Metropolitana y Callao · ${miles(estado.red.vertices)} intersecciones · ` +
    `${miles(estado.red.aristas)} vías dirigidas · ${estado.hospitales.length} hospitales`
}

// ---------------------------------------------------------------- ocupacion

/** Ocupacion de referencia: la de fondo del modelo (ver core/ocupacion.ts). */
function ocupacionReferencial(i: number, hora: number): number {
  return ocupacionFondo(estado.hospitales[i], hora)
}

function ocupaciones(): number[] {
  return estado.hospitales.map(
    (_, i) => estado.manual.get(i) ?? ocupacionReferencial(i, estado.escenario.hora)
  )
}

function dibujarOcupacion(): void {
  const lista = $('listaOcupacion')
  const valores = ocupaciones()
  lista.replaceChildren()
  estado.hospitales.forEach((h, i) => {
    const li = document.createElement('li')
    li.className = 'ocupacion'
    const nombre = document.createElement('span')
    nombre.className = 'ocupacion__nombre'
    nombre.textContent = h.nombreCorto
    nombre.title = `${h.nombre} · ${h.categoria}`
    const control = document.createElement('input')
    control.type = 'range'
    control.min = '0.2'
    control.max = '0.99'
    control.step = '0.01'
    control.value = String(valores[i])
    control.style.setProperty('--color', colorOcupacion(valores[i]))
    const valor = document.createElement('output')
    valor.textContent = porcentaje(valores[i])
    if (estado.manual.has(i)) li.classList.add('ocupacion--manual')
    control.addEventListener('input', () => {
      const v = Number(control.value)
      estado.manual.set(i, v)
      valor.textContent = porcentaje(v)
      control.style.setProperty('--color', colorOcupacion(v))
      li.classList.add('ocupacion--manual')
      actualizarHospitalesEnMapa()
    })
    li.append(nombre, control, valor)
    lista.appendChild(li)
  })
  actualizarHospitalesEnMapa()
}

function colorOcupacion(o: number): string {
  if (o >= OCUPACION_SATURADA - 0.05) return '#ff3b5c'
  if (o >= 0.85) return '#ff8a3d'
  if (o >= 0.7) return '#ffd23d'
  return '#3dffa8'
}

// ---------------------------------------------------------------- mapa

function prepararCapas(): void {
  if (!capa) return
  mapa.addLayer(capa)

  mapa.addSource('ruta-cercano', { type: 'geojson', data: vacio() })
  mapa.addSource('ruta-samu', { type: 'geojson', data: vacio(), lineMetrics: true })
  mapa.addSource('hospitales', { type: 'geojson', data: vacio(), promoteId: 'i' })

  mapa.addLayer({
    id: 'ruta-cercano',
    type: 'line',
    source: 'ruta-cercano',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ff8a3d', 'line-width': 3, 'line-opacity': 0.85, 'line-dasharray': [1.2, 1.6] }
  })
  mapa.addLayer({
    id: 'ruta-samu-halo',
    type: 'line',
    source: 'ruta-samu',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#3dffa8', 'line-width': 14, 'line-blur': 10, 'line-opacity': 0.45 }
  })
  mapa.addLayer({
    id: 'ruta-samu',
    type: 'line',
    source: 'ruta-samu',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': 4.5,
      'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#7cf3ff', 1, '#3dffa8']
    }
  })

  mapa.addLayer({
    id: 'hospitales-halo',
    type: 'circle',
    source: 'hospitales',
    paint: {
      'circle-radius': [
        'case',
        ['boolean', ['feature-state', 'elegido'], false], 26,
        ['boolean', ['feature-state', 'alcanzado'], false], 16,
        0
      ],
      'circle-color': ['case', ['boolean', ['feature-state', 'elegido'], false], '#3dffa8', '#ffffff'],
      'circle-opacity': 0.18,
      'circle-blur': 0.6
    }
  })
  mapa.addLayer({
    id: 'hospitales',
    type: 'circle',
    source: 'hospitales',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['get', 'radio'], 14, ['*', 2, ['get', 'radio']]],
      'circle-color': ['get', 'color'],
      'circle-stroke-color': [
        'case',
        ['boolean', ['feature-state', 'elegido'], false], '#ffffff',
        ['boolean', ['feature-state', 'alcanzado'], false], '#e6f7ff',
        '#0b1020'
      ],
      'circle-stroke-width': ['case', ['boolean', ['feature-state', 'alcanzado'], false], 2.5, 1.5]
    }
  })
  mapa.addLayer({
    id: 'hospitales-nombre',
    type: 'symbol',
    source: 'hospitales',
    minzoom: 10.2,
    layout: {
      'text-field': ['get', 'nombre'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-offset': [0, 1.3],
      'text-anchor': 'top',
      'text-optional': true
    },
    paint: { 'text-color': '#d7e3ff', 'text-halo-color': '#0b1020', 'text-halo-width': 1.4 }
  })

  const ventana = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 })
  mapa.on('mouseenter', 'hospitales', (e) => {
    const f = e.features?.[0]
    if (!f) return
    const h = estado.hospitales[Number(f.properties.i)]
    const o = ocupaciones()[Number(f.properties.i)]
    mapa.getCanvas().style.cursor = 'pointer'
    ventana
      .setLngLat([h.lon, h.lat])
      .setHTML(
        `<strong>${escapar(h.nombre)}</strong><br>${escapar(h.categoria)} · ${escapar(h.red)}<br>` +
          `Ocupación ${porcentaje(o)} · espera estimada ${minutos(esperaEstimada(o))}`
      )
      .addTo(mapa)
  })
  mapa.on('mouseleave', 'hospitales', () => {
    mapa.getCanvas().style.cursor = ''
    ventana.remove()
  })

  actualizarHospitalesEnMapa()
}

function actualizarHospitalesEnMapa(): void {
  const fuente = mapa.getSource('hospitales') as GeoJSONSource | undefined
  if (!fuente) return
  const valores = ocupaciones()
  fuente.setData({
    type: 'FeatureCollection',
    features: estado.hospitales.map((h, i) => ({
      type: 'Feature',
      id: i,
      geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
      properties: {
        i,
        nombre: h.nombreCorto,
        color: colorOcupacion(valores[i]),
        radio: h.nivel === 3 ? 6.5 : 5
      }
    }))
  })
}

function marcarHospitales(clave: 'alcanzado' | 'elegido', indices: Set<number>): void {
  estado.hospitales.forEach((_, i) => {
    mapa.setFeatureState({ source: 'hospitales', id: i }, { [clave]: indices.has(i) })
  })
}

// ---------------------------------------------------------------- despacho

/**
 * Cada despacho lleva un numero de generacion. Cambiar de modo lo invalida:
 * las animaciones en curso se detienen y el despacho no sigue dibujando
 * sobre otra vista.
 */
let generacion = 0

async function despachar(lon: number, lat: number): Promise<void> {
  if (estado.ocupado || !estado.red || !capa) return
  estado.ocupado = true
  const mia = ++generacion
  try {
    await secuenciaDeDespacho(lon, lat, mia)
  } finally {
    estado.ocupado = false
  }
}

async function secuenciaDeDespacho(lon: number, lat: number, mia: number): Promise<void> {
  estado.ultimo = { lon, lat }
  $('tarjeta').hidden = true
  limpiarRutas()
  marcarHospitales('alcanzado', new Set())
  marcarHospitales('elegido', new Set())

  marcadorEmergencia?.remove()
  const punto = document.createElement('div')
  punto.className = 'emergencia'
  marcadorEmergencia = new maplibregl.Marker({ element: punto }).setLngLat([lon, lat]).addTo(mapa)

  const valores = ocupaciones()
  // Acercar la camara a la emergencia: la onda se aprecia calle por calle.
  if (mapa.getZoom() < 11.6) {
    mapa.easeTo({ center: [lon, lat], zoom: 12.2, duration: 700 })
  }
  const r = await motor.despachar(lon, lat, estado.tipo, valores)
  if (mia !== generacion) return

  await animarOnda(r, mia)
  if (mia !== generacion) return
  if (r.samu.hospital < 0) {
    mostrarSinHospital()
    return
  }
  marcarHospitales('elegido', new Set([r.samu.hospital]))
  const rutaSamu = geometriaDeRuta(r.samu.aristasCamino)
  const rutaCercano = r.cercano.hospital !== r.samu.hospital ? geometriaDeRuta(r.cercano.aristasCamino) : []
  ;(mapa.getSource('ruta-cercano') as GeoJSONSource).setData(linea(rutaCercano))
  encuadrar([...rutaSamu, ...rutaCercano, [lon, lat]])
  await animarRuta(rutaSamu, mia)
  if (mia !== generacion) return
  estado.despacho = { r, valores }
  mostrarTarjeta(r, valores)
}

function animarOnda(r: RespuestaDespacho, mia: number): Promise<void> {
  const c = capa!
  c.cargarDistancias(r.distancias)
  const finitas = Array.from(r.distancias.filter((d) => Number.isFinite(d))).sort((a, b) => a - b)
  const limite = finitas[finitas.length - 1] ?? 1
  c.maximo = limite
  c.opacidad = 1
  c.frente = 0

  const hud = $('hud')
  hud.hidden = false
  $('hudRelajaciones').textContent = miles(r.samu.relajaciones)
  $('hudTiempo').textContent = `${r.samu.milisegundos.toFixed(1)} ms`
  const alcanzados = new Set<number>()

  return new Promise((resolver) => {
    const inicio = performance.now()
    const paso = (ahora: number) => {
      if (mia !== generacion) return resolver()
      const f = Math.min(1, (ahora - inicio) / DURACION_ONDA)
      c.frente = limite * suavizar(f)
      $('hudFrente').textContent = `${(c.frente / 60).toFixed(1)} min`
      $('hudAsentados').textContent = miles(contarHasta(finitas, c.frente))
      let cambio = false
      r.samu.llegadas.forEach((t, i) => {
        if (t <= c.frente && !alcanzados.has(i)) {
          alcanzados.add(i)
          cambio = true
        }
      })
      if (cambio) marcarHospitales('alcanzado', alcanzados)
      c.repintar()
      if (f < 1) {
        requestAnimationFrame(paso)
      } else {
        $('hudAsentados').textContent = miles(r.samu.asentados)
        resolver()
      }
    }
    requestAnimationFrame(paso)
  })
}

function animarRuta(ruta: [number, number][], mia: number): Promise<void> {
  const fuente = mapa.getSource('ruta-samu') as GeoJSONSource
  marcadorAmbulancia?.remove()
  // La emergencia puede ocurrir en la misma puerta del hospital: ruta vacia.
  if (ruta.length < 2) return Promise.resolve()
  const acumulado = longitudes(ruta)
  const total = acumulado[acumulado.length - 1] || 1

  const ambulancia = document.createElement('div')
  ambulancia.className = 'ambulancia'
  marcadorAmbulancia = new maplibregl.Marker({ element: ambulancia }).setLngLat(ruta[0]).addTo(mapa)

  return new Promise((resolver) => {
    const inicio = performance.now()
    const paso = (ahora: number) => {
      if (mia !== generacion) return resolver()
      const f = Math.min(1, (ahora - inicio) / DURACION_AMBULANCIA)
      const objetivo = total * suavizar(f)
      let k = 1
      while (k < acumulado.length - 1 && acumulado[k] < objetivo) k++
      const a = ruta[k - 1]
      const b = ruta[k]
      const tramo = acumulado[k] - acumulado[k - 1] || 1
      const t = clamp((objetivo - acumulado[k - 1]) / tramo, 0, 1)
      const actual: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      fuente.setData(linea([...ruta.slice(0, k), actual]))
      marcadorAmbulancia?.setLngLat(actual)
      if (capa) {
        // La zona explorada queda como rastro tenue bajo la ruta.
        capa.opacidad = 1 - 0.45 * f
        capa.repintar()
      }
      if (f < 1) requestAnimationFrame(paso)
      else resolver()
    }
    requestAnimationFrame(paso)
  })
}

/** Geometria continua de la ruta a partir de sus aristas, respetando el sentido de cada tramo. */
function geometriaDeRuta(aristas: number[]): [number, number][] {
  const red = estado.red!
  const [bx, by] = red.base
  const puntos: [number, number][] = []
  for (const k of aristas) {
    const codigo = red.tramoDeArista[k]
    const t = codigo & MASCARA_TRAMO
    const a = red.geoDesplazamientos[t]
    const b = red.geoDesplazamientos[t + 1]
    const indices: number[] = []
    for (let i = a; i < b; i++) indices.push(i)
    if (codigo & BIT_INVERTIDA) indices.reverse()
    for (const i of puntos.length ? indices.slice(1) : indices) {
      puntos.push([red.geometria[2 * i] + bx, red.geometria[2 * i + 1] + by])
    }
  }
  return puntos
}

/** Vias principales de la ruta en orden, con su longitud recorrida. */
function viasDeRuta(aristas: number[]): { nombre: string; metros: number }[] {
  const red = estado.red!
  const vias: { nombre: string; metros: number }[] = []
  for (const k of aristas) {
    const t = red.tramoDeArista[k] & MASCARA_TRAMO
    const nombre = estado.nombres[red.nombre[t]] || ''
    const ultima = vias[vias.length - 1]
    if (ultima && ultima.nombre === nombre) ultima.metros += red.largo[t]
    else vias.push({ nombre, metros: red.largo[t] })
  }
  return vias.filter((v) => v.nombre && v.metros >= 350)
}

function mostrarTarjeta(r: RespuestaDespacho, valores: number[]): void {
  const h = estado.hospitales[r.samu.hospital]
  const tipo = TIPOS.find((t) => t.clave === estado.tipo)!.nombre
  const tarjeta = $('tarjeta')

  const contraste =
    r.cercano.hospital >= 0 && r.cercano.hospital !== r.samu.hospital
      ? (() => {
          const c = estado.hospitales[r.cercano.hospital]
          const ahorro = r.cercano.total - r.samu.total
          return (
            `<p class="contraste"><span class="contraste__linea"></span>Hoy se enviaría al más cercano, ` +
            `<strong>${escapar(c.nombreCorto)}</strong>: ${minutos(r.cercano.viaje)} de viaje, pero ` +
            `${porcentaje(valores[r.cercano.hospital])} de ocupación y ${minutos(r.cercano.espera)} de espera. ` +
            `Total ${minutos(r.cercano.total)}.</p>` +
            `<p class="ahorro">El paciente es atendido <strong>${minutos(ahorro)} antes</strong>.</p>`
          )
        })()
      : `<p class="contraste contraste--igual">Coincide con el hospital elegible más cercano: no está saturado, así que no conviene desviarse.</p>`

  const vias = viasDeRuta(r.samu.aristasCamino)
    .slice(0, 5)
    .map((v) => escapar(v.nombre))
    .join(' → ')

  const ranking = r.samu.llegadas
    .map((t, i) => ({ i, viaje: t, espera: esperaEstimada(valores[i]) }))
    .filter((x) => Number.isFinite(x.viaje))
    .map((x) => ({ ...x, total: x.viaje + x.espera }))
    .sort((a, b) => a.total - b.total)

  const filas = ranking
    .map(
      (x) =>
        `<tr class="${x.i === r.samu.hospital ? 'elegido' : ''}"><td>${escapar(estado.hospitales[x.i].nombreCorto)}</td>` +
        `<td>${minutos(x.viaje)}</td><td>${minutos(x.espera)}</td><td>${minutos(x.total)}</td></tr>`
    )
    .join('')

  tarjeta.innerHTML = `
    <button type="button" class="tarjeta__cerrar" aria-label="Cerrar">×</button>
    <p class="tarjeta__ceja">Despacho recomendado · ${escapar(tipo)}</p>
    <h3 class="tarjeta__hospital">${escapar(h.nombre)}</h3>
    <p class="tarjeta__meta">${escapar(h.categoria)} · ${escapar(h.red)} · ocupación ${porcentaje(valores[r.samu.hospital])}</p>
    <div class="cifras">
      <div><span>Viaje</span><strong>${minutos(r.samu.viaje)}</strong></div>
      <div><span>Espera estimada</span><strong>${minutos(r.samu.espera)}</strong></div>
      <div class="cifras__total"><span>Hasta ser atendido</span><strong>${minutos(r.samu.total)}</strong></div>
    </div>
    ${contraste}
    ${vias ? `<p class="vias"><span>Ruta</span>${vias}</p>` : ''}
    <details class="decision">
      <summary>¿Cómo decidió el algoritmo?</summary>
      <p>Un solo Dijkstra sobre la red ampliada con un <em>sumidero virtual</em>: cada hospital elegible se
      conecta a él con un peso igual a su espera estimada. Dijkstra se detuvo al extraer el sumidero,
      tras asentar ${miles(r.samu.asentados)} intersecciones en ${r.samu.milisegundos.toFixed(1)} ms:
      ningún hospital sin explorar podía mejorar ${minutos(r.samu.total)}.</p>
      <table>
        <thead><tr><th>Hospital alcanzado</th><th>Viaje</th><th>Espera</th><th>Total</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </details>
    <button type="button" class="boton boton--ancho" id="botonAcademico">
      Resolver este caso paso a paso (15 nodos) →
    </button>`
  tarjeta.hidden = false
  tarjeta.querySelector('.tarjeta__cerrar')?.addEventListener('click', () => (tarjeta.hidden = true))
  tarjeta.querySelector('#botonAcademico')?.addEventListener('click', () => void llevarAlAcademico())
}

// ---------------------------------------------------------------- puente con la rubrica

const CODIGOS_HOSPITAL: Record<string, string> = {
  loayza: 'LOA', dos_de_mayo: 'DMY', cayetano: 'CAY', unanue: 'UNA', bernales: 'BER',
  carrion: 'DAC', auxiliadora: 'AUX', ulloa: 'ULL', materno: 'INM', san_bartolome: 'SBA',
  pediatricas: 'HEP', ves: 'HVS', santa_rosa: 'HSR', vitarte: 'VIT', sjl: 'HSJ',
  lanfranco: 'LAN', san_jose_callao: 'SJC', ventanilla: 'HVE', huaycan: 'HUA'
}

const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y'])

function codigoDistrito(nombre: string): string {
  const palabras = nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/\s+/)
    .filter((p) => !VACIAS.has(p.toLowerCase()))
  if (palabras.length >= 3) return palabras.slice(0, 3).map((p) => p[0]).join('')
  if (palabras.length === 2) return palabras[0].slice(0, 2) + palabras[1][0]
  return palabras[0].slice(0, 3)
}

/**
 * Construye el grafo de 15 vertices del caso: la emergencia, hasta 6
 * hospitales candidatos, los distritos vecinos y el sumidero S. Las aristas
 * salen de tiempos reales por la red vial, y lo abre en el modo academico.
 */
async function llevarAlAcademico(): Promise<void> {
  if (!estado.despacho) return
  const { r, valores } = estado.despacho
  const boton = document.getElementById('botonAcademico') as HTMLButtonElement | null
  if (boton) {
    boton.disabled = true
    boton.textContent = 'Midiendo tiempos reales entre los 15 puntos…'
  }

  // Hospitales: el elegido, el mas cercano y los demas alcanzados, por llegada.
  const hospitalesCaso = r.samu.llegadas
    .map((t, i) => ({ i, t }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t)
    .map((x) => x.i)
  for (const obligatorio of [r.cercano.hospital, r.samu.hospital]) {
    if (obligatorio >= 0 && !hospitalesCaso.includes(obligatorio)) hospitalesCaso.unshift(obligatorio)
  }
  const elegidos = [...new Set([r.samu.hospital, r.cercano.hospital, ...hospitalesCaso])]
    .filter((i) => i >= 0)
    .slice(0, 6)

  const origen = estado.ultimo!
  const usados = new Set<number>([r.samu.origen, ...elegidos.map((i) => estado.hospitales[i].vertice)])
  const distritos = estado.distritos
    .map((d) => ({ d, dist: Math.hypot((d.lon - origen.lon) * 0.978, d.lat - origen.lat) }))
    .sort((a, b) => a.dist - b.dist)
    .map((x) => x.d)
    .filter((d) => !usados.has(d.vertice))
    .slice(0, 14 - 1 - elegidos.length)

  const puntos = [
    { codigo: 'EMG', nombre: 'Punto de la emergencia', vertice: r.samu.origen, espera: null as number | null, lon: origen.lon, lat: origen.lat },
    ...elegidos.map((i) => ({
      lon: estado.hospitales[i].lon,
      lat: estado.hospitales[i].lat,
      codigo: CODIGOS_HOSPITAL[estado.hospitales[i].id] ?? estado.hospitales[i].id.slice(0, 3).toUpperCase(),
      nombre: `${estado.hospitales[i].nombre} (espera ${minutos(esperaEstimada(valores[i]))})`,
      vertice: estado.hospitales[i].vertice,
      espera: esperaEstimada(valores[i]) / 60
    })),
    ...distritos.map((d) => ({
      codigo: codigoDistrito(d.nombre),
      nombre: d.nombre,
      vertice: d.vertice,
      espera: null,
      lon: d.lon,
      lat: d.lat
    }))
  ]

  // Codigos unicos.
  const vistos = new Set<string>(['S'])
  for (const p of puntos) {
    let c = p.codigo
    let k = 2
    while (vistos.has(c)) c = p.codigo.slice(0, 2) + k++
    p.codigo = c
    vistos.add(c)
  }

  const segundos = await motor.matriz(puntos.map((p) => p.vertice))
  const base = vecindadRelativa(simetrizar(segundos))
  const matriz = agregarSumidero(base, puntos.map((p) => p.espera))

  // Posiciones geograficas normalizadas; S va a la derecha, fuera del mapa:
  // no es un lugar, es la decision.
  const xs = puntos.map((p) => p.lon * 0.978)
  const ys = puntos.map((p) => -p.lat)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const escala = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0) || 1
  const posiciones = puntos.map((_, i) => ({
    x: ((xs[i] - x0) / escala) * 0.86,
    y: (ys[i] - y0) / escala
  }))
  separar(posiciones, 0.1)
  posiciones.push({ x: 1, y: 0.5 })

  const caso = {
    posiciones,
    codigos: [...puntos.map((p) => p.codigo), 'S'],
    nombres: [...puntos.map((p) => p.nombre), 'Sumidero virtual: llegar a S es ser atendido'],
    matriz,
    origen: 0,
    destino: matriz.length - 1,
    hora: hora(estado.escenario.hora),
    tipo: TIPOS.find((t) => t.clave === estado.tipo)!.nombre,
    hospitalElegido: estado.hospitales[r.samu.hospital].nombre
  }
  localStorage.setItem('camino-minimo:caso', JSON.stringify(caso))
  window.location.href = './academico.html?caso=samu'
}

function mostrarSinHospital(): void {
  const tarjeta = $('tarjeta')
  tarjeta.innerHTML = `<p class="tarjeta__ceja">Sin destino</p>
    <h3 class="tarjeta__hospital">Ningún hospital elegible es alcanzable</h3>
    <p class="tarjeta__meta">El punto no está conectado a la red vial principal.</p>`
  tarjeta.hidden = false
}

function limpiarRutas(): void {
  ;(mapa.getSource('ruta-samu') as GeoJSONSource | undefined)?.setData(vacio())
  ;(mapa.getSource('ruta-cercano') as GeoJSONSource | undefined)?.setData(vacio())
  marcadorAmbulancia?.remove()
}

function encuadrar(puntos: [number, number][]): void {
  if (!puntos.length) return
  const limites = new maplibregl.LngLatBounds(puntos[0], puntos[0])
  for (const p of puntos) limites.extend(p)
  mapa.fitBounds(limites, {
    padding: { top: 120, bottom: 120, left: 400, right: 460 },
    maxZoom: 13.5,
    duration: 900
  })
}

/**
 * Aparta los nodos que quedan encimados (por ejemplo, una emergencia junto
 * al centro de su distrito) hasta una distancia minima, moviendolos lo
 * menos posible para conservar la geografia.
 */
function separar(puntos: { x: number; y: number }[], minima: number): void {
  for (let vuelta = 0; vuelta < 60; vuelta++) {
    let movido = false
    for (let i = 0; i < puntos.length; i++) {
      for (let j = i + 1; j < puntos.length; j++) {
        const dx = puntos[j].x - puntos[i].x
        const dy = puntos[j].y - puntos[i].y
        const d = Math.hypot(dx, dy)
        if (d >= minima) continue
        const ux = d > 1e-9 ? dx / d : Math.cos(i + j)
        const uy = d > 1e-9 ? dy / d : Math.sin(i + j)
        const empuje = (minima - d) / 2
        puntos[i].x -= ux * empuje
        puntos[i].y -= uy * empuje
        puntos[j].x += ux * empuje
        puntos[j].y += uy * empuje
        movido = true
      }
    }
    // El recorte va dentro del ciclo: si se hiciera al final, podria
    // volver a encimar puntos empujados contra el mismo borde.
    for (const p of puntos) {
      p.x = clamp(p.x, 0, 0.88)
      p.y = clamp(p.y, 0, 1)
    }
    if (!movido) break
  }
}

// ---------------------------------------------------------------- escenario

async function cambiarEscenario(cambios: Partial<Escenario>): Promise<void> {
  Object.assign(estado.escenario, cambios)
  const e = estado.escenario
  $('horaValor').textContent = hora(e.hora)
  $('horaNota').textContent = describirHora(e.hora)
  $('intensidadValor').textContent = `${e.intensidad.toFixed(1)}×`
  $('sirenaValor').textContent = porcentaje(e.sirena)
  $('prudenciaValor').textContent = porcentaje(e.prudencia)
  ;($('hora') as HTMLInputElement).value = String(e.hora)
  ;($('intensidad') as HTMLInputElement).value = String(e.intensidad)
  ;($('sirena') as HTMLInputElement).value = String(e.sirena)
  ;($('prudencia') as HTMLInputElement).value = String(e.prudencia)
  dibujarOcupacion()
  await motor.escenario(e)
}

function describirHora(h: number): string {
  const p = perfilTrafico(h)
  if (p > 0.75) return h < 12 ? 'hora punta de la mañana' : 'hora punta de la tarde'
  if (p > 0.3) return 'tráfico moderado'
  return 'vías despejadas'
}

const PREAJUSTES: { nombre: string; aplicar: () => void }[] = [
  { nombre: 'Madrugada', aplicar: () => { estado.manual.clear(); void cambiarEscenario({ hora: 3, intensidad: 1 }) } },
  { nombre: 'Hora punta', aplicar: () => { estado.manual.clear(); void cambiarEscenario({ hora: 18.75, intensidad: 1.15 }) } },
  { nombre: 'Lluvia', aplicar: () => void cambiarEscenario({ intensidad: 1.7 }) },
  {
    nombre: 'Brote respiratorio',
    aplicar: () => {
      // Emergencia sanitaria: todos los servicios suben de ocupacion y los
      // grandes hospitales de referencia se acercan a la saturacion.
      estado.hospitales.forEach((h, i) => {
        const base = ocupacionReferencial(i, estado.escenario.hora)
        estado.manual.set(i, clamp(base + (h.nivel === 3 ? 0.24 : 0.14), 0.2, 0.98))
      })
      elegirTipo('respiratoria')
      void cambiarEscenario({})
    }
  }
]

function elegirTipo(tipo: TipoEmergencia): void {
  estado.tipo = tipo
  document.querySelectorAll<HTMLButtonElement>('#tiposEmergencia .ficha').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.tipo === tipo))
  })
}

function prepararControles(): void {
  const contenedor = $('tiposEmergencia')
  for (const t of TIPOS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'ficha'
    b.dataset.tipo = t.clave
    b.setAttribute('role', 'radio')
    b.textContent = t.nombre
    b.addEventListener('click', () => {
      elegirTipo(t.clave)
      if (estado.ultimo) void despachar(estado.ultimo.lon, estado.ultimo.lat)
    })
    contenedor.appendChild(b)
  }
  elegirTipo(estado.tipo)

  const preajustes = $('preajustes')
  for (const p of PREAJUSTES) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'ficha'
    b.textContent = p.nombre
    b.addEventListener('click', p.aplicar)
    preajustes.appendChild(b)
  }

  for (const clave of ['hora', 'intensidad', 'sirena', 'prudencia'] as const) {
    const control = $(clave) as HTMLInputElement
    control.addEventListener('input', () => {
      void cambiarEscenario({ [clave]: Number(control.value) })
    })
  }

  $('restablecerOcupacion').addEventListener('click', () => {
    estado.manual.clear()
    dibujarOcupacion()
  })

  mapa.on('click', (e) => {
    if (document.body.dataset.modo !== 'despacho') return
    const features = mapa.queryRenderedFeatures(e.point, { layers: ['hospitales'] })
    if (features.length) return
    void despachar(e.lngLat.lng, e.lngLat.lat)
  })

  document.querySelectorAll<HTMLButtonElement>('.pestana[data-modo]').forEach((b) => {
    b.addEventListener('click', () => cambiarModo(b.dataset.modo as 'despacho' | 'simulacion'))
  })
}

let simulacion: { activar(): void; desactivar(): void } | null = null

function cambiarModo(modo: 'despacho' | 'simulacion'): void {
  generacion++ // invalida cualquier despacho en curso
  document.body.dataset.modo = modo
  document.querySelectorAll('.pestana[data-modo]').forEach((b) => {
    b.classList.toggle('pestana--activa', (b as HTMLElement).dataset.modo === modo)
  })
  $('panelDespacho').hidden = modo !== 'despacho'
  $('panelSimulacion').hidden = modo !== 'simulacion'
  $('tarjeta').hidden = true
  $('hud').hidden = true
  limpiarRutas()
  marcadorEmergencia?.remove()
  if (capa) {
    capa.opacidad = 0
    capa.repintar()
  }
  if (modo === 'simulacion') {
    simulacion ??= iniciarSimulacion({
      mapa,
      motor,
      hospitales: estado.hospitales,
      escenario: () => estado.escenario,
      colorOcupacion,
      alCambiarOcupacion: (valores) => {
        valores.forEach((v, i) => estado.manual.set(i, v))
        actualizarHospitalesEnMapa()
      }
    })
    simulacion.activar()
  } else {
    simulacion?.desactivar()
    estado.manual.clear()
    dibujarOcupacion()
  }
}

// ---------------------------------------------------------------- utilidades

function vacio(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

function linea(puntos: [number, number][]): GeoJSON.FeatureCollection {
  if (puntos.length < 2) return vacio()
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: puntos } }]
  }
}

function longitudes(ruta: [number, number][]): number[] {
  const acumulado = [0]
  for (let i = 1; i < ruta.length; i++) {
    const dx = (ruta[i][0] - ruta[i - 1][0]) * 0.978
    const dy = ruta[i][1] - ruta[i - 1][1]
    acumulado.push(acumulado[i - 1] + Math.hypot(dx, dy))
  }
  return acumulado
}

function contarHasta(ordenadas: number[], limite: number): number {
  let bajo = 0
  let alto = ordenadas.length
  while (bajo < alto) {
    const medio = (bajo + alto) >> 1
    if (ordenadas[medio] <= limite) bajo = medio + 1
    else alto = medio
  }
  return bajo
}

function suavizar(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function clamp(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x))
}

export function minutos(segundos: number): string {
  if (!Number.isFinite(segundos)) return '—'
  const m = segundos / 60
  if (m < 60) return `${m.toFixed(m < 10 ? 1 : 0)} min`
  const h = Math.floor(m / 60)
  return `${h} h ${String(Math.round(m - h * 60)).padStart(2, '0')} min`
}

function porcentaje(x: number): string {
  return `${Math.round(x * 100)} %`
}

function miles(n: number): string {
  return n.toLocaleString('es-PE')
}

function hora(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

// ---------------------------------------------------------------- arranque

document.body.dataset.modo = 'despacho'
if (import.meta.env.DEV) {
  // Acceso para pruebas automatizadas en desarrollo.
  Object.assign(window, { __mapa: mapa, __despachar: despachar })
}
prepararControles()
const mapaListo = new Promise<void>((r) => mapa.once('load', () => r()))

Promise.all([cargar(), mapaListo])
  .then(async () => {
    prepararCapas()
    await cambiarEscenario({})
    $('carga').classList.add('carga--oculta')
  })
  .catch((error) => {
    $('cargaDetalle').textContent = 'No se pudo iniciar: ' + String(error)
  })
