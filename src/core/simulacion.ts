/**
 * simulacion.ts
 *
 * Simulacion en tiempo discreto de una jornada de despacho de emergencias
 * medicas para el SAMU en Lima.
 *
 * Evalua dos mundos paralelos que reciben exactamente el mismo flujo de
 * incidentes pero aplican politicas de despacho distintas:
 *
 *   1. 'cercano': envia la ambulancia al hospital elegible con menor tiempo
 *      de viaje, ignorando el estado de su servicio de emergencia (politica
 *      habitual no coordinada).
 *   2. 'samu': envia la ambulancia al hospital elegible que minimiza la suma
 *      del tiempo de viaje mas la espera estimada en cola segun su ocupacion
 *      actual (despacho global coordinado).
 *
 * El flujo de incidentes sigue un proceso de Poisson no homogeneo con tasa
 * modulada por la hora del dia (perfil de demanda). Cada mundo mantiene su
 * propia dinamica de ocupacion hospitalaria: los pacientes derivados ingresan
 * al hospital al completar su viaje y permanecen un tiempo de estancia
 * exponencial antes de ser dados de alta.
 */

import { elegibles, esperaEstimada, OCUPACION_SATURADA } from './despacho.ts'
import type { Hospital, TipoEmergencia } from './despacho.ts'
import { crearGenerador } from './aleatorio.ts'
import { ocupacionFondo } from './ocupacion.ts'

export type Politica = 'samu' | 'cercano'

export interface Distrito {
  nombre: string
  poblacion: number
  lon: number
  lat: number
  vertice: number
}

export interface Incidente {
  id: number
  /** Segundos transcurridos desde el inicio de la simulacion. */
  t: number
  /** Indice del distrito de origen en la lista de distritos. */
  distrito: number
  vertice: number
  tipo: TipoEmergencia
}

export interface Asignacion {
  /** Indice del hospital elegido; -1 si ninguno es alcanzable. */
  hospital: number
  /** Tiempo de viaje en segundos; Infinity si no alcanzable. */
  viaje: number
  /** Tiempo de espera estimado en cola en segundos; Infinity si no alcanzable. */
  espera: number
  /** Tiempo total (viaje + espera) en segundos; Infinity si no alcanzable. */
  total: number
}

export interface EventoIncidente {
  incidente: Incidente
  samu: Asignacion
  cercano: Asignacion
}

export interface Metricas {
  atendidos: number
  viajeMedio: number
  esperaMedia: number
  totalMedio: number
  p90Total: number
  maximoTotal: number
  /** Suma sobre todos los hospitales de los minutos simulados con ocupacion >= OCUPACION_SATURADA. */
  minutosSaturados: number
}

export interface OpcionesSimulacion {
  hospitales: Hospital[]
  distritos: Distrito[]
  /** tablas[i][v] = segundos de viaje del vertice v al hospital i (Float32Array, Infinity si inalcanzable). */
  tablas: Float32Array[]
  semilla: number
  /** Hora del dia al inicio t=0, valor entre 0 y 24. */
  horaInicio: number
  /** Tasa media de incidentes por hora (proceso de Poisson). */
  incidentesPorHora: number
  /** Pesos de probabilidad por TipoEmergencia; por defecto DISTRIBUCION_TIPOS. */
  distribucion?: Partial<Record<TipoEmergencia, number>>
  /** Estancia media de un paciente en emergencia en segundos; por defecto 3 horas (10800 s). */
  estanciaMedia?: number
}

/** Distribucion tipica de tipos de emergencia observada en atenciones prehospitalarias. */
export const DISTRIBUCION_TIPOS: Record<TipoEmergencia, number> = {
  trauma: 0.30,
  cardiaca: 0.15,
  respiratoria: 0.20,
  obstetrica: 0.10,
  pediatrica: 0.10,
  general: 0.15
}

const TIPOS_EMERGENCIA: TipoEmergencia[] = [
  'trauma',
  'cardiaca',
  'respiratoria',
  'obstetrica',
  'pediatrica',
  'general'
]

/**
 * Modulacion circadiana de la tasa de emergencias.
 * Minimo a las 04:00 (0.6) y maximo a las 16:00 (1.0).
 */
export function perfilDemanda(h: number): number {
  return 0.6 + (0.4 * (1 - Math.cos((2 * Math.PI * (h - 4)) / 24))) / 2
}

interface EventoPaciente {
  t: number
  hospital: number
  delta: number
}

/**
 * Cola de prioridad minima para eventos de transicion de carga de pacientes
 * (llegada al hospital y alta tras finalizar la estancia).
 */
class ColaEventos {
  private elementos: EventoPaciente[] = []

  get vacia(): boolean {
    return this.elementos.length === 0
  }

  tiempoProximo(): number {
    return this.elementos.length > 0 ? this.elementos[0].t : Infinity
  }

  insertar(evento: EventoPaciente): void {
    this.elementos.push(evento)
    let i = this.elementos.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.elementos[p].t <= this.elementos[i].t) {
        break
      }
      const tmp = this.elementos[p]
      this.elementos[p] = this.elementos[i]
      this.elementos[i] = tmp
      i = p
    }
  }

  extraer(): EventoPaciente | undefined {
    if (this.elementos.length === 0) {
      return undefined
    }
    const raiz = this.elementos[0]
    const ultimo = this.elementos.pop()!
    if (this.elementos.length > 0) {
      this.elementos[0] = ultimo
      let i = 0
      const n = this.elementos.length
      while (true) {
        let menor = i
        const izq = (i << 1) + 1
        const der = izq + 1
        if (izq < n && this.elementos[izq].t < this.elementos[menor].t) {
          menor = izq
        }
        if (der < n && this.elementos[der].t < this.elementos[menor].t) {
          menor = der
        }
        if (menor === i) {
          break
        }
        const tmp = this.elementos[i]
        this.elementos[i] = this.elementos[menor]
        this.elementos[menor] = tmp
        i = menor
      }
    }
    return raiz
  }
}

interface EstadoMundo {
  carga: Int32Array
  cola: ColaEventos
  asignaciones: Asignacion[]
  minutosSaturados: number
  azarEstancia: () => number
}

/**
 * Simulador de despacho de emergencias en tiempo discreto.
 */
export class Simulacion {
  private hospitales: Hospital[]
  private distritos: Distrito[]
  private tablas: Float32Array[]
  private horaInicio: number
  private incidentesPorHora: number
  private estanciaMedia: number

  private _tiempo = 0
  private _siguienteId = 0
  private _azarIncidentes: () => number
  private _presupuestoExponencial = 0

  private poblacionTotal = 0
  private pesosTipos: { tipo: TipoEmergencia; peso: number }[] = []
  private pesoTotalTipos = 0

  private mundoSamu: EstadoMundo
  private mundoCercano: EstadoMundo

  constructor(opciones: OpcionesSimulacion) {
    this.hospitales = opciones.hospitales
    this.distritos = opciones.distritos
    this.tablas = opciones.tablas
    this.horaInicio = opciones.horaInicio
    this.incidentesPorHora = opciones.incidentesPorHora
    this.estanciaMedia = opciones.estanciaMedia ?? 3 * 3600

    // Generador del flujo de incidentes (comun e identico para ambos mundos)
    this._azarIncidentes = crearGenerador(opciones.semilla)

    // Generadores independientes para los tiempos de estancia de cada mundo
    this.mundoSamu = {
      carga: new Int32Array(this.hospitales.length),
      cola: new ColaEventos(),
      asignaciones: [],
      minutosSaturados: 0,
      azarEstancia: crearGenerador(opciones.semilla + 1)
    }

    this.mundoCercano = {
      carga: new Int32Array(this.hospitales.length),
      cola: new ColaEventos(),
      asignaciones: [],
      minutosSaturados: 0,
      azarEstancia: crearGenerador(opciones.semilla + 2)
    }

    // Precalculo de pesos poblacionales
    this.poblacionTotal = 0
    for (const d of this.distritos) {
      this.poblacionTotal += Math.max(0, d.poblacion)
    }

    // Precalculo de distribucion de tipos de emergencia
    const distEntrada = opciones.distribucion
    let sumaPesos = 0
    this.pesosTipos = []
    for (const t of TIPOS_EMERGENCIA) {
      const peso = distEntrada ? (distEntrada[t] ?? 0) : DISTRIBUCION_TIPOS[t]
      const pesoValido = Math.max(0, peso)
      this.pesosTipos.push({ tipo: t, peso: pesoValido })
      sumaPesos += pesoValido
    }
    if (sumaPesos <= 0) {
      this.pesosTipos = []
      sumaPesos = 0
      for (const t of TIPOS_EMERGENCIA) {
        const pesoValido = DISTRIBUCION_TIPOS[t]
        this.pesosTipos.push({ tipo: t, peso: pesoValido })
        sumaPesos += pesoValido
      }
    }
    this.pesoTotalTipos = sumaPesos

    // Inicializar el presupuesto exponencial para el primer incidente
    this._presupuestoExponencial = this.generarPresupuestoExponencial()
  }

  /** Segundos simulados desde el inicio. */
  get tiempo(): number {
    return this._tiempo
  }

  /** Hora del dia en punto flotante (0..24), avanzando con el tiempo simulado. */
  get hora(): number {
    return ((this.horaInicio + this._tiempo / 3600) % 24 + 24) % 24
  }

  /** Reemplaza las tablas de viaje cuando la matriz de trafico cambia de horario. */
  actualizarTablas(tablas: Float32Array[]): void {
    this.tablas = tablas
  }

  /**
   * Avanza la simulacion dt segundos.
   * Procesa el avance en subpasos internos de maximo 60 segundos para modular
   * la tasa de Poisson y acumular la saturacion con resolucion de un minuto.
   */
  avanzar(dt: number): EventoIncidente[] {
    if (dt <= 0) {
      return []
    }

    const eventosGenerados: EventoIncidente[] = []
    let restante = dt

    while (restante > 0) {
      const paso = Math.min(restante, 60)
      const tFinPaso = this._tiempo + paso

      while (this._tiempo < tFinPaso) {
        this.procesarEventosPacientesHasta(this._tiempo)

        const tProxPaciente = Math.min(
          this.mundoSamu.cola.tiempoProximo(),
          this.mundoCercano.cola.tiempoProximo()
        )

        const tasa = this.tasaIncidentes(this.hora)
        let tProxIncidente = Infinity
        if (tasa > 0) {
          tProxIncidente = this._tiempo + this._presupuestoExponencial / tasa
        }

        const tHito = Math.min(tFinPaso, tProxPaciente, tProxIncidente)
        const delta = tHito - this._tiempo

        if (delta > 0 && tasa > 0) {
          this._presupuestoExponencial = Math.max(0, this._presupuestoExponencial - delta * tasa)
        }
        this._tiempo = tHito

        this.procesarEventosPacientesHasta(tHito)

        if (tHito === tProxIncidente && tHito <= tFinPaso) {
          const ev = this.generarYDespacharIncidente(tHito)
          eventosGenerados.push(ev)
          this._presupuestoExponencial = this.generarPresupuestoExponencial()
        }
      }

      this.acumularMinutosSaturados(paso)
      restante -= paso
    }

    return eventosGenerados
  }

  /** Retorna un arreglo con la ocupacion actual de cada hospital (entre 0 y 0.99). */
  ocupacion(politica: Politica): Float64Array {
    const res = new Float64Array(this.hospitales.length)
    for (let i = 0; i < this.hospitales.length; i++) {
      res[i] = this.ocupacionHospital(politica, i)
    }
    return res
  }

  /** Resumen de metricas sobre los incidentes atendidos y saturacion acumulada. */
  metricas(politica: Politica): Metricas {
    const mundo = politica === 'samu' ? this.mundoSamu : this.mundoCercano
    const asigs = mundo.asignaciones
    const n = asigs.length

    if (n === 0) {
      return {
        atendidos: 0,
        viajeMedio: 0,
        esperaMedia: 0,
        totalMedio: 0,
        p90Total: 0,
        maximoTotal: 0,
        minutosSaturados: mundo.minutosSaturados
      }
    }

    let sumaViaje = 0
    let sumaEspera = 0
    let sumaTotal = 0
    let maximoTotal = -Infinity
    const totales = new Float64Array(n)

    for (let i = 0; i < n; i++) {
      const a = asigs[i]
      sumaViaje += a.viaje
      sumaEspera += a.espera
      sumaTotal += a.total
      totales[i] = a.total
      if (a.total > maximoTotal) {
        maximoTotal = a.total
      }
    }

    totales.sort()
    const indiceP90 = Math.min(n - 1, Math.max(0, Math.ceil(0.9 * n) - 1))
    const p90Total = totales[indiceP90]

    return {
      atendidos: n,
      viajeMedio: sumaViaje / n,
      esperaMedia: sumaEspera / n,
      totalMedio: sumaTotal / n,
      p90Total,
      maximoTotal: maximoTotal === -Infinity ? 0 : maximoTotal,
      minutosSaturados: mundo.minutosSaturados
    }
  }

  private generarPresupuestoExponencial(): number {
    const u = this._azarIncidentes()
    const factor = Math.max(1e-12, Math.min(1 - 1e-12, 1 - u))
    return -Math.log(factor)
  }

  private tasaIncidentes(h: number): number {
    if (this.incidentesPorHora <= 0) {
      return 0
    }
    return (this.incidentesPorHora * perfilDemanda(h)) / 3600
  }

  /**
   * Ocupacion = fondo propio del hospital (pacientes que llegan por su cuenta,
   * distinto en cada hospital y segun la hora) + carga de pacientes del SAMU.
   * Con un fondo uniforme todas las esperas se parecerian y el hospital mas
   * cercano seria casi siempre el optimo; la heterogeneidad es lo que hace
   * que mirar la espera cambie la decision.
   */
  private ocupacionHospital(politica: Politica, i: number): number {
    const carga = politica === 'samu' ? this.mundoSamu.carga[i] : this.mundoCercano.carga[i]
    const cap = Math.max(1, this.hospitales[i].capacidadHora)
    // El servicio absorbe tantas horas de su capacidad como dura una estancia media.
    const horasEstancia = this.estanciaMedia / 3600
    const oc = ocupacionFondo(this.hospitales[i], this.hora) + carga / (cap * horasEstancia)
    return Math.min(0.99, Math.max(0, oc))
  }

  private procesarEventosPacientesHasta(tLimite: number): void {
    while (this.mundoSamu.cola.tiempoProximo() <= tLimite) {
      const ev = this.mundoSamu.cola.extraer()!
      this.mundoSamu.carga[ev.hospital] = Math.max(0, this.mundoSamu.carga[ev.hospital] + ev.delta)
    }

    while (this.mundoCercano.cola.tiempoProximo() <= tLimite) {
      const ev = this.mundoCercano.cola.extraer()!
      this.mundoCercano.carga[ev.hospital] = Math.max(0, this.mundoCercano.carga[ev.hospital] + ev.delta)
    }
  }

  private acumularMinutosSaturados(pasoSegundos: number): void {
    const pasoMinutos = pasoSegundos / 60
    for (let i = 0; i < this.hospitales.length; i++) {
      if (this.ocupacionHospital('samu', i) >= OCUPACION_SATURADA) {
        this.mundoSamu.minutosSaturados += pasoMinutos
      }
      if (this.ocupacionHospital('cercano', i) >= OCUPACION_SATURADA) {
        this.mundoCercano.minutosSaturados += pasoMinutos
      }
    }
  }

  private elegirDistrito(): number {
    if (this.distritos.length === 0) {
      return -1
    }
    if (this.poblacionTotal <= 0) {
      return 0
    }
    const r = this._azarIncidentes() * this.poblacionTotal
    let acumulado = 0
    for (let i = 0; i < this.distritos.length - 1; i++) {
      acumulado += Math.max(0, this.distritos[i].poblacion)
      if (r < acumulado) {
        return i
      }
    }
    return this.distritos.length - 1
  }

  private elegirTipo(): TipoEmergencia {
    const r = this._azarIncidentes() * this.pesoTotalTipos
    let acumulado = 0
    for (let i = 0; i < this.pesosTipos.length - 1; i++) {
      acumulado += this.pesosTipos[i].peso
      if (r < acumulado) {
        return this.pesosTipos[i].tipo
      }
    }
    return this.pesosTipos[this.pesosTipos.length - 1].tipo
  }

  private despacharCercano(incidente: Incidente): Asignacion {
    const candidatos = elegibles(this.hospitales, incidente.tipo)
    let mejorH = -1
    let mejorViaje = Infinity

    for (const i of candidatos) {
      const tabla = this.tablas[i]
      if (!tabla || incidente.vertice < 0 || incidente.vertice >= tabla.length) {
        continue
      }
      const viaje = tabla[incidente.vertice]
      if (Number.isFinite(viaje) && viaje >= 0) {
        if (viaje < mejorViaje) {
          mejorViaje = viaje
          mejorH = i
        }
      }
    }

    if (mejorH === -1 || !Number.isFinite(mejorViaje)) {
      return { hospital: -1, viaje: Infinity, espera: Infinity, total: Infinity }
    }

    const oc = this.ocupacionHospital('cercano', mejorH)
    const espera = esperaEstimada(oc)
    return {
      hospital: mejorH,
      viaje: mejorViaje,
      espera,
      total: mejorViaje + espera
    }
  }

  private despacharSamu(incidente: Incidente): Asignacion {
    const candidatos = elegibles(this.hospitales, incidente.tipo)
    let mejorH = -1
    let mejorTotal = Infinity
    let mejorViaje = Infinity
    let mejorEspera = Infinity

    for (const i of candidatos) {
      const tabla = this.tablas[i]
      if (!tabla || incidente.vertice < 0 || incidente.vertice >= tabla.length) {
        continue
      }
      const viaje = tabla[incidente.vertice]
      if (Number.isFinite(viaje) && viaje >= 0) {
        const oc = this.ocupacionHospital('samu', i)
        const espera = esperaEstimada(oc)
        const total = viaje + espera
        if (total < mejorTotal) {
          mejorTotal = total
          mejorH = i
          mejorViaje = viaje
          mejorEspera = espera
        }
      }
    }

    if (mejorH === -1 || !Number.isFinite(mejorTotal)) {
      return { hospital: -1, viaje: Infinity, espera: Infinity, total: Infinity }
    }

    return {
      hospital: mejorH,
      viaje: mejorViaje,
      espera: mejorEspera,
      total: mejorTotal
    }
  }

  private generarYDespacharIncidente(t: number): EventoIncidente {
    const distritoIdx = this.elegirDistrito()
    const vertice = distritoIdx >= 0 ? this.distritos[distritoIdx].vertice : -1
    const tipo = this.elegirTipo()

    const incidente: Incidente = {
      id: this._siguienteId++,
      t,
      distrito: distritoIdx,
      vertice,
      tipo
    }

    const samu = this.despacharSamu(incidente)
    const cercano = this.despacharCercano(incidente)

    if (samu.hospital >= 0) {
      this.mundoSamu.asignaciones.push(samu)
      const u = this.mundoSamu.azarEstancia()
      const factor = Math.max(1e-12, Math.min(1 - 1e-12, 1 - u))
      const estancia = -this.estanciaMedia * Math.log(factor)
      // La carga se reserva al despachar, no al llegar: la central sabe a donde
      // van sus ambulancias, y si solo contara las que ya llegaron enviaria
      // varias seguidas al mismo hospital creyendolo libre.
      const tSalida = t + samu.viaje + estancia
      this.mundoSamu.carga[samu.hospital]++
      this.mundoSamu.cola.insertar({ t: tSalida, hospital: samu.hospital, delta: -1 })
    }

    if (cercano.hospital >= 0) {
      this.mundoCercano.asignaciones.push(cercano)
      const u = this.mundoCercano.azarEstancia()
      const factor = Math.max(1e-12, Math.min(1 - 1e-12, 1 - u))
      const estancia = -this.estanciaMedia * Math.log(factor)
      const tSalida = t + cercano.viaje + estancia
      this.mundoCercano.carga[cercano.hospital]++
      this.mundoCercano.cola.insertar({ t: tSalida, hospital: cercano.hospital, delta: -1 })
    }

    return { incidente, samu, cercano }
  }
}
