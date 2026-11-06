/**
 * trabajador.ts
 *
 * Web Worker que ejecuta el motor fuera del hilo de la interfaz. Mientras
 * Dijkstra recorre la red, el mapa sigue respondiendo.
 *
 * Protocolo: cada mensaje lleva un id; la respuesta repite ese id.
 */

import { type Escenario, pesosDeRed } from '../core/costos.ts'
import {
  type Hospital,
  type TipoEmergencia,
  despachar,
  elegibles,
  esperaEstimada,
  tiemposDesde
} from '../core/despacho.ts'
import { type RedVial, invertir, leerRed, verticeMasCercano } from '../core/red.ts'

export type Pedido =
  | { id: number; tipo: 'iniciar'; red: ArrayBuffer; hospitales: Hospital[] }
  | { id: number; tipo: 'escenario'; escenario: Escenario }
  | {
      id: number
      tipo: 'despachar'
      lon: number
      lat: number
      emergencia: TipoEmergencia
      ocupaciones: number[]
    }
  | { id: number; tipo: 'tablas' }
  | { id: number; tipo: 'matriz'; puntos: number[] }

export interface DespachoEnviado {
  origen: number
  hospital: number
  viaje: number
  espera: number
  total: number
  camino: number[]
  aristasCamino: number[]
  llegadas: number[]
  asentados: number
  relajaciones: number
  milisegundos: number
}

export interface RespuestaDespacho {
  samu: DespachoEnviado
  /** Lo que se hace hoy: el hospital elegible mas cercano, sin mirar la espera. */
  cercano: DespachoEnviado
  /** Etiquetas definitivas del despacho SAMU (para la onda). */
  distancias: Float32Array
}

let red: RedVial | null = null
let inversa: RedVial | null = null
let hospitales: Hospital[] = []
let pesos: Float32Array | null = null
let pesosInversos: Float32Array | null = null

/** Lo minimo del ambito del worker; tsconfig usa la libreria DOM, no la de workers. */
interface AmbitoTrabajador {
  onmessage: ((evento: MessageEvent<Pedido>) => void) | null
  postMessage(mensaje: unknown, transferir?: Transferable[]): void
}

const contexto = self as unknown as AmbitoTrabajador

contexto.onmessage = (evento: MessageEvent<Pedido>) => {
  const pedido = evento.data
  try {
    const respuesta = atender(pedido)
    contexto.postMessage({ id: pedido.id, ok: true, datos: respuesta.datos }, respuesta.transferir)
  } catch (error) {
    contexto.postMessage({ id: pedido.id, ok: false, error: String(error) })
  }
}

function atender(pedido: Pedido): { datos: unknown; transferir: Transferable[] } {
  switch (pedido.tipo) {
    case 'iniciar': {
      red = leerRed(pedido.red)
      inversa = invertir(red)
      hospitales = pedido.hospitales
      return { datos: { vertices: red.vertices, aristas: red.aristas }, transferir: [] }
    }
    case 'escenario': {
      const r = exigirRed()
      pesos = pesosDeRed(r, pedido.escenario)
      pesosInversos = pesosDeRed(exigirInversa(), pedido.escenario)
      return { datos: null, transferir: [] }
    }
    case 'despachar': {
      const r = exigirRed()
      const p = exigirPesos()
      const origen = verticeMasCercano(r, pedido.lon, pedido.lat)
      const lista = elegibles(hospitales, pedido.emergencia)

      const samu = despachar(
        r,
        p,
        origen,
        hospitales,
        lista.map((i) => ({ hospital: i, espera: esperaEstimada(pedido.ocupaciones[i]) })),
        { registrar: true }
      )
      // Politica actual: espera cero para todos, gana el mas cercano.
      const cercano = despachar(
        r,
        p,
        origen,
        hospitales,
        lista.map((i) => ({ hospital: i, espera: 0 }))
      )
      // Lo que realmente costaria ir al mas cercano: su viaje mas su espera real.
      if (cercano.hospital >= 0) {
        cercano.espera = esperaEstimada(pedido.ocupaciones[cercano.hospital])
        cercano.total = cercano.viaje + cercano.espera
      }

      const respuesta: RespuestaDespacho = {
        samu: resumir(samu),
        cercano: resumir(cercano),
        distancias: samu.distancias
      }
      return { datos: respuesta, transferir: [samu.distancias.buffer] }
    }
    case 'tablas': {
      // Tiempo desde cada punto de Lima hacia cada hospital: un Dijkstra por
      // hospital sobre la red inversa. Lo usa la simulacion.
      const inv = exigirInversa()
      const pi = exigirPesosInversos()
      const tablas = hospitales.map((h) => tiemposDesde(inv, pi, h.vertice))
      return { datos: tablas, transferir: tablas.map((t) => t.buffer) }
    }
    case 'matriz': {
      // Tiempo entre cada par de puntos clave, por la red real.
      const r = exigirRed()
      const p = exigirPesos()
      const matriz = pedido.puntos.map((desde) => {
        const tiempos = tiemposDesde(r, p, desde)
        return pedido.puntos.map((hasta) => tiempos[hasta])
      })
      return { datos: matriz, transferir: [] }
    }
  }
}

function resumir(r: ReturnType<typeof despachar>): DespachoEnviado {
  return {
    origen: r.origen,
    hospital: r.hospital,
    viaje: r.viaje,
    espera: r.espera,
    total: r.total,
    camino: r.camino,
    aristasCamino: r.aristasCamino,
    llegadas: Array.from(r.llegadas),
    asentados: r.asentados,
    relajaciones: r.relajaciones,
    milisegundos: r.milisegundos
  }
}

function exigirRed(): RedVial {
  if (!red) throw new Error('La red aun no se ha cargado.')
  return red
}
function exigirInversa(): RedVial {
  if (!inversa) throw new Error('La red aun no se ha cargado.')
  return inversa
}
function exigirPesos(): Float32Array {
  if (!pesos) throw new Error('Falta definir el escenario.')
  return pesos
}
function exigirPesosInversos(): Float32Array {
  if (!pesosInversos) throw new Error('Falta definir el escenario.')
  return pesosInversos
}
