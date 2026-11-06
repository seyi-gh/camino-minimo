/**
 * costos.ts
 *
 * Modelo procedural del tiempo de viaje de una ambulancia por cada tramo.
 *
 * Lima no publica velocidades medidas por calle y OpenStreetMap solo declara
 * la velocidad maxima en una fraccion de los tramos. En lugar de inventar
 * datos, el peso de cada arista se deriva de reglas explicitas:
 *
 *   tiempo = largo / velocidad_libre
 *            x congestion(clase, hora)          trafico por franja horaria
 *            x (1 + incertidumbre(datos))        penalizacion por dato faltante
 *            x variacion_local(tramo)            semaforos, cruces, estado
 *            + demora_de_cruce(clase)
 *
 * Todas las reglas son deterministas: el mismo escenario produce siempre los
 * mismos pesos, y por tanto las mismas rutas. La penalizacion por dato
 * faltante hace que, ante dos rutas equivalentes, el sistema prefiera la que
 * esta mejor documentada: una decision conservadora cuando hay vidas en juego.
 */

import {
  MASCARA_TRAMO,
  NO_PAVIMENTADA,
  type RedVial,
  TIENE_CARRILES,
  TIENE_SUPERFICIE,
  TIENE_VELOCIDAD
} from './red.ts'

export interface Escenario {
  /** Hora del dia, de 0 a 24 (admite fracciones). */
  hora: number
  /**
   * Fraccion del trafico que la sirena logra apartar, de 0 a 1.
   * 0: la ambulancia sufre el trafico como cualquier vehiculo.
   */
  sirena: number
  /** Peso de la penalizacion por dato faltante, de 0 a 1. */
  prudencia: number
  /** Multiplicador global de trafico (lluvia, evento masivo, paro). */
  intensidad: number
}

export const ESCENARIO_BASE: Escenario = {
  hora: 8,
  sirena: 0.4,
  prudencia: 0.5,
  intensidad: 1
}

/** Velocidad libre por clase de via, en km/h. */
const VELOCIDAD_LIBRE: Record<string, number> = {
  motorway: 80,
  trunk: 60,
  primary: 45,
  secondary: 38,
  tertiary: 32,
  unclassified: 25,
  residential: 22,
  living_street: 10,
  motorway_link: 50,
  trunk_link: 40,
  primary_link: 32,
  secondary_link: 28,
  tertiary_link: 25
}

/**
 * Sensibilidad de cada clase a la hora punta: las vias expresas y arteriales
 * concentran el trafico de Lima; las residenciales casi no lo sienten.
 */
const SENSIBILIDAD: Record<string, number> = {
  motorway: 1.7,
  trunk: 1.5,
  primary: 1.35,
  secondary: 1.0,
  tertiary: 0.7,
  unclassified: 0.45,
  residential: 0.3,
  living_street: 0.1,
  motorway_link: 1.4,
  trunk_link: 1.2,
  primary_link: 1.1,
  secondary_link: 0.8,
  tertiary_link: 0.6
}

/** Demora media por cruce al entrar al tramo, en segundos. */
const DEMORA_CRUCE: Record<string, number> = {
  motorway: 0,
  trunk: 4,
  primary: 8,
  secondary: 7,
  tertiary: 6,
  unclassified: 4,
  residential: 3,
  living_street: 3,
  motorway_link: 2,
  trunk_link: 4,
  primary_link: 5,
  secondary_link: 5,
  tertiary_link: 4
}

function campana(x: number, centro: number, ancho: number): number {
  // Distancia circular en horas, para que las 23:30 y las 00:30 sean vecinas.
  let d = Math.abs(x - centro) % 24
  if (d > 12) {
    d = 24 - d
  }
  return Math.exp(-(d * d) / (2 * ancho * ancho))
}

/**
 * Perfil de trafico de Lima entre 0 (madrugada libre) y ~1 (hora punta):
 * punta de manana hacia las 7:45, punta de tarde mas larga hacia las 19:00
 * y un repunte al mediodia.
 */
export function perfilTrafico(hora: number): number {
  return (
    1.0 * campana(hora, 7.75, 1.1) +
    0.95 * campana(hora, 19.0, 1.6) +
    0.35 * campana(hora, 13.25, 1.2)
  )
}

/** Variacion local reproducible en [0.92, 1.12], a partir del indice del tramo. */
function variacionLocal(tramo: number): number {
  let h = Math.imul(tramo ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return 0.92 + ((h >>> 0) / 4294967296) * 0.2
}

/** Fraccion de datos faltantes del tramo, entre 0 y 1. */
export function faltaDeDatos(banderas: number): number {
  let faltan = 0
  if (!(banderas & TIENE_VELOCIDAD)) faltan++
  if (!(banderas & TIENE_CARRILES)) faltan++
  if (!(banderas & TIENE_SUPERFICIE)) faltan++
  return faltan / 3
}

/** Tiempo de recorrido del tramo t en segundos bajo el escenario dado. */
export function tiempoDeTramo(red: RedVial, t: number, escenario: Escenario): number {
  const clase = red.clases[red.clase[t]]
  const banderas = red.banderas[t]

  let velocidad = VELOCIDAD_LIBRE[clase] ?? 20
  const declarada = red.velocidad[t]
  if (declarada > 0) {
    // El limite legal no es la velocidad real: se toma el 85 % y nunca
    // mas que la velocidad libre de una via superior.
    velocidad = Math.min(declarada * 0.85, velocidad * 1.25)
  }
  if (banderas & NO_PAVIMENTADA) {
    velocidad *= 0.55
  }

  const libre = red.largo[t] / ((velocidad * 1000) / 3600)

  const congestion =
    1 +
    (SENSIBILIDAD[clase] ?? 0.5) *
      perfilTrafico(escenario.hora) *
      escenario.intensidad *
      (1 - escenario.sirena)

  const incertidumbre = 1 + 0.35 * escenario.prudencia * faltaDeDatos(banderas)

  return libre * congestion * incertidumbre * variacionLocal(t) + (DEMORA_CRUCE[clase] ?? 4)
}

/**
 * Peso de todas las aristas dirigidas en segundos. Se recalcula al cambiar
 * de escenario; para medio millon de aristas toma unos pocos milisegundos.
 */
export function pesosDeRed(red: RedVial, escenario: Escenario): Float32Array {
  const porTramo = new Float32Array(red.tramos)
  for (let t = 0; t < red.tramos; t++) {
    porTramo[t] = tiempoDeTramo(red, t, escenario)
  }
  const pesos = new Float32Array(red.aristas)
  for (let k = 0; k < red.aristas; k++) {
    pesos[k] = porTramo[red.tramoDeArista[k] & MASCARA_TRAMO]
  }
  return pesos
}
