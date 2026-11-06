/**
 * motor.ts
 *
 * Interfaz con promesas sobre el Web Worker del motor de despacho.
 */

import type { Escenario } from '../core/costos.ts'
import type { Hospital, TipoEmergencia } from '../core/despacho.ts'
import type { Pedido, RespuestaDespacho } from './trabajador.ts'

type SinId<T> = T extends { id: number } ? Omit<T, 'id'> : never

export class Motor {
  private trabajador = new Worker(new URL('./trabajador.ts', import.meta.url), { type: 'module' })
  private siguiente = 1
  private pendientes = new Map<number, { resolver: (v: unknown) => void; rechazar: (e: Error) => void }>()

  constructor() {
    this.trabajador.onmessage = (evento) => {
      const { id, ok, datos, error } = evento.data
      const pendiente = this.pendientes.get(id)
      if (!pendiente) return
      this.pendientes.delete(id)
      if (ok) pendiente.resolver(datos)
      else pendiente.rechazar(new Error(error))
    }
  }

  private llamar<T>(pedido: SinId<Pedido>, transferir: Transferable[] = []): Promise<T> {
    const id = this.siguiente++
    return new Promise<T>((resolver, rechazar) => {
      this.pendientes.set(id, { resolver: resolver as (v: unknown) => void, rechazar })
      this.trabajador.postMessage({ ...pedido, id }, transferir)
    })
  }

  iniciar(red: ArrayBuffer, hospitales: Hospital[]): Promise<{ vertices: number; aristas: number }> {
    return this.llamar({ tipo: 'iniciar', red, hospitales }, [red])
  }

  escenario(escenario: Escenario): Promise<void> {
    return this.llamar({ tipo: 'escenario', escenario: { ...escenario } })
  }

  despachar(
    lon: number,
    lat: number,
    emergencia: TipoEmergencia,
    ocupaciones: number[]
  ): Promise<RespuestaDespacho> {
    return this.llamar({ tipo: 'despachar', lon, lat, emergencia, ocupaciones })
  }

  /** Tiempo desde cada vertice hacia cada hospital (un arreglo por hospital). */
  tablas(): Promise<Float32Array[]> {
    return this.llamar({ tipo: 'tablas' })
  }

  /** Tiempo entre cada par de vertices dados, por la red real. */
  matriz(puntos: number[]): Promise<number[][]> {
    return this.llamar({ tipo: 'matriz', puntos })
  }
}
