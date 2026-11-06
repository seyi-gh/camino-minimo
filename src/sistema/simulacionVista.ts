/**
 * simulacionVista.ts
 *
 * Vista de la simulacion en vivo: dos mundos paralelos reciben las mismas
 * emergencias. En el mapa se ven los traslados de ambos (verde: sumidero
 * virtual; naranja punteado: hospital mas cercano, cuando difieren) y la
 * ocupacion de los hospitales en el mundo con despacho inteligente.
 */

import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import type { Escenario } from '../core/costos.ts'
import type { Hospital } from '../core/despacho.ts'
import { type Distrito, type EventoIncidente, type Metricas, type Politica, Simulacion } from '../core/simulacion.ts'
import type { Motor } from './motor.ts'

interface Contexto {
  mapa: maplibregl.Map
  motor: Motor
  hospitales: Hospital[]
  escenario: () => Escenario
  colorOcupacion: (o: number) => string
  alCambiarOcupacion: (valores: number[]) => void
}

interface Viaje {
  desde: [number, number]
  hasta: [number, number]
  /** Instante simulado de salida y duracion del viaje, en segundos. */
  inicio: number
  duracion: number
  mundo: Politica
}

const SEMILLA = 2026
const MAX_VIAJES = 160

export function iniciarSimulacion(ctx: Contexto): { activar(): void; desactivar(): void } {
  const { mapa, motor, hospitales } = ctx
  const $ = (id: string) => document.getElementById(id)!
  const tasa = $('simTasa') as HTMLInputElement
  const velocidad = $('simVelocidad') as HTMLInputElement
  const botonIniciar = $('simIniciar') as HTMLButtonElement

  let distritos: Distrito[] = []
  let sim: Simulacion | null = null
  let corriendo = false
  let horaTablas = -1
  let pidiendoTablas = false
  let ultimoCuadro = 0
  let viajes: Viaje[] = []
  const serie: { t: number; samu: number; cercano: number }[] = []

  const listo = fetch('./datos/distritos.json')
    .then((r) => r.json())
    .then((d) => (distritos = d.distritos))

  function prepararCapas(): void {
    if (mapa.getSource('sim-arcos')) return
    mapa.addSource('sim-arcos', { type: 'geojson', data: vacio() })
    mapa.addSource('sim-unidades', { type: 'geojson', data: vacio() })
    mapa.addLayer({
      id: 'sim-arcos',
      type: 'line',
      source: 'sim-arcos',
      paint: {
        'line-color': ['match', ['get', 'mundo'], 'samu', '#3dffa8', '#ff8a3d'],
        'line-width': ['match', ['get', 'mundo'], 'samu', 1.8, 1.2],
        'line-opacity': ['get', 'opacidad']
      }
    })
    mapa.addLayer({
      id: 'sim-unidades',
      type: 'circle',
      source: 'sim-unidades',
      paint: {
        'circle-radius': 4,
        'circle-color': ['match', ['get', 'mundo'], 'samu', '#e9fff5', '#ffd2b3'],
        'circle-stroke-width': 2,
        'circle-stroke-color': ['match', ['get', 'mundo'], 'samu', '#3dffa8', '#ff8a3d'],
        'circle-blur': 0.15
      }
    })
  }

  /**
   * Todas las operaciones de la simulacion con el worker pasan por esta cola,
   * una tras otra. Asi, al salir del modo, la restauracion del escenario del
   * despacho llega despues de cualquier calculo pendiente y no se pisa.
   */
  let tareas: Promise<unknown> = Promise.resolve()
  let activo = false
  let preparando = false

  function encolar<T>(tarea: () => Promise<T>): Promise<T> {
    const siguiente = tareas.then(tarea)
    tareas = siguiente.catch((error) => console.error(error))
    return siguiente
  }

  function crear(): Promise<void> {
    return encolar(async () => {
      await listo
      if (!activo) return
      const e = ctx.escenario()
      const hora = Math.floor(e.hora)
      await motor.escenario({ ...e, hora })
      const tablas = await motor.tablas()
      if (!activo) return
      construir(tablas, hora)
    })
  }

  function construir(tablas: Float32Array[], hora: number): void {
    horaTablas = hora
    sim = new Simulacion({
      hospitales,
      distritos,
      tablas,
      semilla: SEMILLA,
      horaInicio: hora,
      incidentesPorHora: Number(tasa.value)
    })
    viajes = []
    serie.length = 0
    dibujarMetricas()
  }

  /** Al cambiar la hora simulada, el trafico cambia: se recalculan las tablas. */
  function refrescarTablas(): void {
    if (!sim || pidiendoTablas) return
    const instancia = sim
    const hora = Math.floor(instancia.hora)
    if (hora === horaTablas) return
    pidiendoTablas = true
    void encolar(async () => {
      try {
        if (!activo || sim !== instancia) return
        await motor.escenario({ ...ctx.escenario(), hora })
        const tablas = await motor.tablas()
        // Si se reinicio o se salio del modo mientras tanto, se descartan.
        if (!activo || sim !== instancia) return
        instancia.actualizarTablas(tablas)
        horaTablas = hora
      } finally {
        pidiendoTablas = false
      }
    })
  }

  function registrar(eventos: EventoIncidente[]): void {
    for (const ev of eventos) {
      const d = distritos[ev.incidente.distrito]
      const desde: [number, number] = [d.lon, d.lat]
      for (const mundo of ['samu', 'cercano'] as const) {
        const a = ev[mundo]
        if (a.hospital < 0) continue
        // El traslado al mas cercano solo se dibuja cuando difiere: es el contraste.
        if (mundo === 'cercano' && a.hospital === ev.samu.hospital) continue
        const h = hospitales[a.hospital]
        viajes.push({ desde, hasta: [h.lon, h.lat], inicio: ev.incidente.t, duracion: a.viaje, mundo })
      }
    }
    if (viajes.length > MAX_VIAJES) viajes = viajes.slice(-MAX_VIAJES)
  }

  function dibujarViajes(): void {
    if (!sim) return
    const t = sim.tiempo
    const arcos: GeoJSON.Feature[] = []
    const unidades: GeoJSON.Feature[] = []
    viajes = viajes.filter((v) => t < v.inicio + v.duracion + 1800)
    for (const v of viajes) {
      const f = Math.min(1, Math.max(0, (t - v.inicio) / Math.max(v.duracion, 1)))
      const curva = arco(v.desde, v.hasta)
      const desvanecer = t > v.inicio + v.duracion ? 1 - (t - v.inicio - v.duracion) / 1800 : 1
      arcos.push({
        type: 'Feature',
        properties: { mundo: v.mundo, opacidad: 0.75 * desvanecer },
        geometry: { type: 'LineString', coordinates: curva }
      })
      if (f < 1) {
        unidades.push({
          type: 'Feature',
          properties: { mundo: v.mundo },
          geometry: { type: 'Point', coordinates: curva[Math.round(f * (curva.length - 1))] }
        })
      }
    }
    ;(mapa.getSource('sim-arcos') as GeoJSONSource).setData({ type: 'FeatureCollection', features: arcos })
    ;(mapa.getSource('sim-unidades') as GeoJSONSource).setData({ type: 'FeatureCollection', features: unidades })
  }

  function dibujarMetricas(): void {
    const reloj = $('simReloj')
    const contenedor = $('simMetricas')
    if (!sim) {
      reloj.textContent = '--:--'
      contenedor.replaceChildren()
      return
    }
    const h = sim.hora
    const dia = Math.floor(sim.tiempo / 86400)
    reloj.textContent =
      `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}` +
      (dia > 0 ? ` +${dia}d` : '')

    const s = sim.metricas('samu')
    const c = sim.metricas('cercano')
    const ahorro = c.totalMedio - s.totalMedio
    const relativo = c.totalMedio > 0 ? ahorro / c.totalMedio : 0

    contenedor.innerHTML = `
      ${mundo('cercano', 'Hoy: hospital más cercano', c)}
      ${mundo('samu', 'Propuesta: sumidero virtual', s)}
      ${
        s.atendidos > 0
          ? `<p class="veredicto">Con el despacho propuesto, el paciente promedio es atendido
             <strong>${min(ahorro)} antes</strong> (${Math.round(relativo * 100)} % menos), y el peor caso
             pasa de ${min(c.maximoTotal)} a ${min(s.maximoTotal)}.</p>`
          : '<p class="texto">Aún no llegan emergencias.</p>'
      }
      <canvas class="grafica" id="simGrafica" width="600" height="240"></canvas>`
    dibujarGrafica($('simGrafica') as HTMLCanvasElement)
  }

  function mundo(clave: Politica, titulo: string, m: Metricas): string {
    return `<div class="mundo mundo--${clave}">
      <p class="mundo__titulo">${titulo}</p>
      <dl>
        <dt>Emergencias atendidas</dt><dd>${m.atendidos}</dd>
        <dt>Viaje medio</dt><dd>${min(m.viajeMedio)}</dd>
        <dt>Espera media</dt><dd>${min(m.esperaMedia)}</dd>
        <dt>Hasta ser atendido</dt><dd>${min(m.totalMedio)}</dd>
        <dt>Percentil 90</dt><dd>${min(m.p90Total)}</dd>
        <dt>Minutos de hospitales saturados</dt><dd>${Math.round(m.minutosSaturados)}</dd>
      </dl>
    </div>`
  }

  function dibujarGrafica(lienzo: HTMLCanvasElement): void {
    const g = lienzo.getContext('2d')
    if (!g || serie.length < 2) return
    const w = lienzo.width
    const h = lienzo.height
    const maximo = Math.max(...serie.map((p) => Math.max(p.samu, p.cercano)), 1)
    const t0 = serie[0].t
    const t1 = serie[serie.length - 1].t || 1
    g.clearRect(0, 0, w, h)
    g.font = '20px IBM Plex Mono'
    g.fillStyle = '#8d9bc2'
    g.fillText('tiempo medio hasta la atención', 8, 22)
    for (const [clave, color] of [['cercano', '#ff8a3d'], ['samu', '#3dffa8']] as const) {
      g.strokeStyle = color
      g.lineWidth = 3
      g.beginPath()
      serie.forEach((p, i) => {
        const x = ((p.t - t0) / Math.max(t1 - t0, 1)) * (w - 16) + 8
        const y = h - 10 - (p[clave] / maximo) * (h - 44)
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      })
      g.stroke()
    }
  }

  let ultimaMetrica = 0
  function cuadro(ahora: number): void {
    if (!corriendo || !sim) return
    const dt = Math.min(0.1, (ahora - ultimoCuadro) / 1000)
    ultimoCuadro = ahora
    // velocidad en minutos simulados por segundo real
    const eventos = sim.avanzar(dt * Number(velocidad.value) * 60)
    registrar(eventos)
    dibujarViajes()
    refrescarTablas()
    if (ahora - ultimaMetrica > 400) {
      ultimaMetrica = ahora
      const s = sim.metricas('samu')
      const c = sim.metricas('cercano')
      if (s.atendidos > 0) serie.push({ t: sim.tiempo, samu: s.totalMedio / 60, cercano: c.totalMedio / 60 })
      ctx.alCambiarOcupacion(Array.from(sim.ocupacion('samu')))
      dibujarMetricas()
    }
    requestAnimationFrame(cuadro)
  }

  botonIniciar.addEventListener('click', async () => {
    if (preparando) return
    if (!sim) {
      preparando = true
      botonIniciar.textContent = 'Calculando tiempos…'
      await crear()
      preparando = false
      if (!activo || !sim) {
        botonIniciar.textContent = 'Iniciar'
        return
      }
    }
    corriendo = !corriendo
    botonIniciar.textContent = corriendo ? 'Pausar' : 'Continuar'
    if (corriendo) {
      ultimoCuadro = performance.now()
      requestAnimationFrame(cuadro)
    }
  })

  $('simReiniciar').addEventListener('click', () => {
    if (preparando) return
    corriendo = false
    botonIniciar.textContent = 'Iniciar'
    sim = null
    horaTablas = -1
    viajes = []
    for (const id of ['sim-arcos', 'sim-unidades']) {
      ;(mapa.getSource(id) as GeoJSONSource | undefined)?.setData(vacio())
    }
    dibujarMetricas()
  })

  tasa.addEventListener('input', () => {
    $('simTasaValor').textContent = tasa.value
  })
  velocidad.addEventListener('input', () => {
    $('simVelocidadValor').textContent = `${velocidad.value} min/s`
  })

  return {
    activar() {
      activo = true
      prepararCapas()
      for (const id of ['sim-arcos', 'sim-unidades']) mapa.setLayoutProperty(id, 'visibility', 'visible')
      mapa.flyTo({ center: [-77.03, -12.04], zoom: 10.3, duration: 800 })
      dibujarMetricas()
    },
    desactivar() {
      activo = false
      corriendo = false
      botonIniciar.textContent = sim ? 'Continuar' : 'Iniciar'
      for (const id of ['sim-arcos', 'sim-unidades']) {
        if (mapa.getLayer(id)) mapa.setLayoutProperty(id, 'visibility', 'none')
      }
      // Devuelve al motor el escenario del modo despacho.
      horaTablas = -1
      void encolar(() => motor.escenario(ctx.escenario()))
    }
  }
}

/** Arco suave entre dos puntos, para distinguir traslados que comparten destino. */
function arco(a: [number, number], b: [number, number], pasos = 24): [number, number][] {
  const mx = (a[0] + b[0]) / 2
  const my = (a[1] + b[1]) / 2
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const cx = mx - dy * 0.18
  const cy = my + dx * 0.18
  const puntos: [number, number][] = []
  for (let i = 0; i <= pasos; i++) {
    const t = i / pasos
    const u = 1 - t
    puntos.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]])
  }
  return puntos
}

function vacio(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

function min(segundos: number): string {
  if (!Number.isFinite(segundos)) return '—'
  const m = segundos / 60
  if (m < 60) return `${m.toFixed(1)} min`
  const h = Math.floor(m / 60)
  return `${h} h ${String(Math.round(m - h * 60)).padStart(2, '0')} min`
}
