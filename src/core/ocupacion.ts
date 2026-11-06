/**
 * ocupacion.ts
 *
 * Ocupacion de fondo de cada servicio de emergencia: la que generan los
 * pacientes que llegan por sus propios medios, sin contar los del SAMU.
 *
 * No hay datos publicos de ocupacion en tiempo real, asi que se modela con
 * tres reglas explicitas y reproducibles:
 *   1. sigue la demanda del dia (minima a las 4:00, maxima a las 16:00);
 *   2. los grandes hospitales de referencia (nivel III con mucha capacidad)
 *      viven mas cargados, porque la poblacion acude directamente a ellos;
 *   3. cada hospital tiene un desplazamiento propio, fijo, derivado de su
 *      identificador, que representa diferencias locales no modeladas.
 */

import type { Hospital } from './despacho.ts'

/** Demanda relativa del dia, entre 0 (4:00) y 1 (16:00). */
export function demandaDelDia(hora: number): number {
  return (1 - Math.cos((2 * Math.PI * (hora - 4)) / 24)) / 2
}

function desplazamientoPropio(id: string): number {
  let semilla = 0
  for (const c of id) semilla = (semilla * 31 + c.charCodeAt(0)) >>> 0
  return ((semilla % 1000) / 1000) * 0.22 - 0.08
}

/** Ocupacion de fondo del hospital a la hora dada, entre 0.2 y 0.95. */
export function ocupacionFondo(h: Hospital, hora: number): number {
  const grande = h.nivel === 3 && h.capacidadHora >= 12 ? 0.06 : 0
  const valor = 0.42 + 0.3 * (0.5 + 0.5 * demandaDelDia(hora)) + desplazamientoPropio(h.id) + grande
  return Math.min(0.95, Math.max(0.2, valor))
}
