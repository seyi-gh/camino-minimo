/**
 * simulacion.ts
 *
 * Pruebas del modulo de simulacion en tiempo discreto de despacho SAMU.
 *
 * Verifica sobre un escenario sintetico:
 *   (a) Determinismo: dos simulaciones identicas producen exactamente las
 *       mismas metricas tras 6 horas de avance en pasos de 60 s.
 *   (b) Consistencia entre mundos: ambos reciben el mismo flujo de
 *       incidentes (mismo id, tiempo de ocurrencia y tipo de emergencia).
 *   (c) Eficacia de la politica SAMU: bajo alta demanda (30 inc/h), el
 *       despacho coordinado logra totalMedio <= cercano.totalMedio.
 *   (d) Comportamiento de 'cercano': ante distancias hand-picked, siempre
 *       elige el hospital 0 (el mas proximo a todos los distritos).
 *   (e) Cotas de ocupacion: la ocupacion se mantiene en [0, 0.99] en todo
 *       momento.
 *   (f) Optimalidad de 'samu': el tiempo total asignado coincide con el
 *       minimo viaje + esperaEstimada(ocupacion) evaluado al despacho.
 */

import {
  Simulacion,
  type Distrito,
  type EventoIncidente,
  type OpcionesSimulacion
} from '../src/core/simulacion.ts'
import { esperaEstimada, type Hospital, type TipoEmergencia } from '../src/core/despacho.ts'

const TIPOS_TODOS: TipoEmergencia[] = [
  'trauma',
  'cardiaca',
  'respiratoria',
  'obstetrica',
  'pediatrica',
  'general'
]

function construirEscenarioSintetico(): {
  hospitales: Hospital[]
  distritos: Distrito[]
  tablas: Float32Array[]
} {
  const hospitales: Hospital[] = [
    {
      id: 'h0',
      nombre: 'Hospital Central',
      nombreCorto: 'Central',
      vertice: 0,
      lon: -77.03,
      lat: -12.05,
      nivel: 3,
      capacidadHora: 4,
      atiende: [...TIPOS_TODOS],
      red: 'Red Centro'
    },
    {
      id: 'h1',
      nombre: 'Hospital Norte',
      nombreCorto: 'Norte',
      vertice: 1,
      lon: -77.05,
      lat: -12.01,
      nivel: 2,
      capacidadHora: 4,
      atiende: [...TIPOS_TODOS],
      red: 'Red Norte'
    },
    {
      id: 'h2',
      nombre: 'Hospital Este',
      nombreCorto: 'Este',
      vertice: 2,
      lon: -76.98,
      lat: -12.04,
      nivel: 2,
      capacidadHora: 4,
      atiende: [...TIPOS_TODOS],
      red: 'Red Este'
    }
  ]

  const distritos: Distrito[] = [
    { nombre: 'Distrito A', poblacion: 80000, lon: -77.04, lat: -12.06, vertice: 3 },
    { nombre: 'Distrito B', poblacion: 60000, lon: -77.02, lat: -12.07, vertice: 4 }
  ]

  // Tiempos elegidos a mano para que el hospital 0 sea estrictamente el mas
  // cercano a ambos distritos (vertice 3 y vertice 4).
  const tablas: Float32Array[] = [
    // H0: viaje de 300 s desde vertice 3 y 300 s desde vertice 4
    new Float32Array([0, 400, 500, 300, 300]),
    // H1: viaje de 600 s desde vertice 3 y 650 s desde vertice 4
    new Float32Array([400, 0, 700, 600, 650]),
    // H2: viaje de 900 s desde vertice 3 y 950 s desde vertice 4
    new Float32Array([500, 700, 0, 900, 950])
  ]

  return { hospitales, distritos, tablas }
}

function probarSimulacion(): boolean {
  console.log('=== Pruebas de Simulacion de Despacho SAMU ===\n')

  const { hospitales, distritos, tablas } = construirEscenarioSintetico()

  const opcionesBase: OpcionesSimulacion = {
    hospitales,
    distritos,
    tablas,
    semilla: 42,
    horaInicio: 8,
    incidentesPorHora: 30
  }

  const sim1 = new Simulacion({ ...opcionesBase })
  const sim2 = new Simulacion({ ...opcionesBase })

  const DURACION = 6 * 3600 // 6 horas
  const PASO = 60 // pasos de 60 s
  const PASOS = DURACION / PASO

  const eventos1: EventoIncidente[] = []
  const eventos2: EventoIncidente[] = []

  let ocupacionValida = true

  for (let i = 0; i < PASOS; i++) {
    const ev1 = sim1.avanzar(PASO)
    const ev2 = sim2.avanzar(PASO)

    eventos1.push(...ev1)
    eventos2.push(...ev2)

    // (e) Verificar que la ocupacion permanezca en [0, 0.99]
    for (const pol of ['samu', 'cercano'] as const) {
      const oc = sim1.ocupacion(pol)
      for (let h = 0; h < oc.length; h++) {
        if (oc[h] < 0 || oc[h] > 0.99 || !Number.isFinite(oc[h])) {
          ocupacionValida = false
        }
      }
    }
  }

  // (a) Determinismo
  const m1Samu = sim1.metricas('samu')
  const m2Samu = sim2.metricas('samu')
  const m1Cercano = sim1.metricas('cercano')
  const m2Cercano = sim2.metricas('cercano')

  const determinismoOk =
    JSON.stringify(m1Samu) === JSON.stringify(m2Samu) &&
    JSON.stringify(m1Cercano) === JSON.stringify(m2Cercano)

  console.log(`(a) Determinismo en 6 horas (${PASOS} pasos de 60s): ${determinismoOk ? 'OK' : 'FALLO'}`)

  // (b) Mismo flujo de incidentes
  let incidentesIdenticos = eventos1.length === eventos2.length && eventos1.length > 0
  if (incidentesIdenticos) {
    for (let i = 0; i < eventos1.length; i++) {
      const a = eventos1[i].incidente
      const b = eventos2[i].incidente
      if (a.id !== b.id || a.t !== b.t || a.tipo !== b.tipo || a.distrito !== b.distrito) {
        incidentesIdenticos = false
        break
      }
    }
  }
  console.log(`(b) Flujo de incidentes identico (${eventos1.length} eventos): ${incidentesIdenticos ? 'OK' : 'FALLO'}`)

  // (c) Alta demanda: SAMU tiene totalMedio <= Cercano
  const samuMejorOIgual = m1Samu.totalMedio <= m1Cercano.totalMedio
  console.log(
    `(c) SAMU totalMedio (${m1Samu.totalMedio.toFixed(1)}s) <= Cercano totalMedio (${m1Cercano.totalMedio.toFixed(1)}s): ${
      samuMejorOIgual ? 'OK' : 'FALLO'
    }`
  )
  console.log(
    `    Espera media: SAMU ${m1Samu.esperaMedia.toFixed(1)}s vs Cercano ${m1Cercano.esperaMedia.toFixed(1)}s`
  )
  console.log(
    `    Minutos saturados: SAMU ${m1Samu.minutosSaturados.toFixed(1)} min vs Cercano ${m1Cercano.minutosSaturados.toFixed(1)} min`
  )

  // (d) 'cercano' siempre elige hospital 0
  let cercanoSiempreH0 = eventos1.length > 0
  for (const ev of eventos1) {
    if (ev.cercano.hospital !== 0) {
      cercanoSiempreH0 = false
      break
    }
  }
  console.log(`(d) 'cercano' siempre elige hospital 0: ${cercanoSiempreH0 ? 'OK' : 'FALLO'}`)

  // (e) Rango de ocupacion en [0, 0.99]
  console.log(`(e) Ocupacion dentro del rango [0, 0.99]: ${ocupacionValida ? 'OK' : 'FALLO'}`)

  // (f) Recomputo de optimalidad de SAMU al momento de despacho
  // Se avanza una simulacion en pasos minusculos para muestrear la ocupacion
  // justo antes de que ocurra el incidente.
  const simOpt = new Simulacion({
    hospitales,
    distritos,
    tablas,
    semilla: 101,
    horaInicio: 12,
    incidentesPorHora: 20
  })

  let optimosComprobados = 0
  let optimosCorrectos = 0
  const DT_CHICO = 1 // 1 segundo para capturar el estado inmediatamente previo

  for (let paso = 0; paso < 3600 && optimosComprobados < 10; paso++) {
    const ocAntes = simOpt.ocupacion('samu')
    const evs = simOpt.avanzar(DT_CHICO)

    for (const ev of evs) {
      optimosComprobados++
      let menorCosto = Infinity
      for (let h = 0; h < hospitales.length; h++) {
        const viaje = tablas[h][ev.incidente.vertice]
        const espera = esperaEstimada(ocAntes[h])
        const total = viaje + espera
        if (total < menorCosto) {
          menorCosto = total
        }
      }

      // Con dt=1s la ocupacion antes del paso coincide con la del despacho
      // salvo si un paciente arribo en ese mismo segundo.
      if (Math.abs(ev.samu.total - menorCosto) < 1.0) {
        optimosCorrectos++
      }
    }
  }

  const optimalidadOk = optimosComprobados > 0 && optimosCorrectos === optimosComprobados
  console.log(
    `(f) Minimo viaje + espera verificado en ${optimosCorrectos}/${optimosComprobados} despachos: ${
      optimalidadOk ? 'OK' : 'FALLO'
    }`
  )

  const todoOk =
    determinismoOk &&
    incidentesIdenticos &&
    samuMejorOIgual &&
    cercanoSiempreH0 &&
    ocupacionValida &&
    optimalidadOk

  return todoOk
}

const exito = probarSimulacion()

if (exito) {
  console.log('\nTodas las pruebas de simulacion pasaron exitosamente.')
} else {
  console.error('\nHubo fallos en las pruebas de simulacion.')
  process.exit(1)
}
