/**
 * capaOnda.ts
 *
 * Capa WebGL que dibuja la exploracion de Dijkstra sobre las calles reales.
 *
 * Cada punto de la geometria de cada tramo lleva un atributo: el instante en
 * que Dijkstra lo alcanza (la etiqueta definitiva de sus extremos,
 * interpolada a lo largo del tramo). La geometria se sube a la GPU una sola
 * vez; al despachar solo se reescribe ese atributo, y la animacion consiste
 * en avanzar un umbral: el shader muestra los puntos cuyo instante ya paso.
 * Asi se ven a 60 cuadros por segundo cientos de miles de tramos.
 *
 * Lo que se ve es literalmente el algoritmo: el frente de la onda es el
 * conjunto de vertices con etiqueta igual al umbral, y la onda se detiene
 * donde Dijkstra se detuvo.
 */

import type * as maplibregl from 'maplibre-gl'
import type { CustomLayerInterface, CustomRenderMethodInput } from 'maplibre-gl'
import { MASCARA_TRAMO, BIT_INVERTIDA, type RedVial } from '../core/red.ts'
import { PALETA } from './tema.ts'

const vec3 = (c: [number, number, number]): string => `vec3(${c.map((v) => v.toFixed(3)).join(', ')})`

const NO_ALCANZADO = 1e9

const SOMBREADOR_VERTICES = `#version 300 es
in vec2 aPosicion;
in float aTiempo;
uniform mat4 uMatriz;
out float vTiempo;
void main() {
  vTiempo = aTiempo;
  gl_Position = uMatriz * vec4(aPosicion, 0.0, 1.0);
}`

const SOMBREADOR_FRAGMENTOS = `#version 300 es
precision highp float;
in float vTiempo;
uniform float uFrente;
uniform float uMaximo;
uniform float uOpacidad;
out vec4 color;
void main() {
  if (vTiempo > uFrente) discard;
  float edad = uFrente - vTiempo;
  // Brillo del frente: decae en los ultimos segundos simulados recorridos.
  float brillo = exp(-edad / (uMaximo * 0.035 + 1.0));
  float avance = clamp(vTiempo / max(uMaximo, 1.0), 0.0, 1.0);
  vec3 cerca = ${vec3(PALETA.onda.cerca)};
  vec3 lejos = ${vec3(PALETA.onda.lejos)};
  vec3 base = mix(cerca, lejos, avance);
  vec3 c = mix(base * 0.85, ${vec3(PALETA.onda.frente)}, brillo);
  float a = (0.45 + 0.55 * brillo) * uOpacidad;
  color = vec4(c * a, a);
}`

export class CapaOnda implements CustomLayerInterface {
  id = 'onda-dijkstra'
  type = 'custom' as const
  renderingMode = '2d' as const

  private mapa: maplibregl.Map | null = null
  private gl: WebGL2RenderingContext | null = null
  private programa: WebGLProgram | null = null
  private bufferPosiciones: WebGLBuffer | null = null
  private bufferTiempos: WebGLBuffer | null = null
  private vao: WebGLVertexArrayObject | null = null
  private uniformes: Record<string, WebGLUniformLocation | null> = {}

  /** Para cada punto de linea dibujado: tramo y fraccion recorrida del tramo. */
  private posiciones: Float32Array
  private tramoDePunto: Int32Array
  private fraccionDePunto: Float32Array
  private tiempos: Float32Array
  private inicioTramo: Int32Array
  private finTramo: Int32Array
  private puntos: number

  frente = 0
  maximo = 1
  opacidad = 0

  constructor(red: RedVial) {
    // Extremos de cada tramo en el sentido de su geometria.
    this.inicioTramo = new Int32Array(red.tramos).fill(-1)
    this.finTramo = new Int32Array(red.tramos).fill(-1)
    for (let u = 0; u < red.vertices; u++) {
      for (let k = red.desplazamientos[u]; k < red.desplazamientos[u + 1]; k++) {
        const codigo = red.tramoDeArista[k]
        const t = codigo & MASCARA_TRAMO
        const v = red.destinos[k]
        if (codigo & BIT_INVERTIDA) {
          this.inicioTramo[t] = v
          this.finTramo[t] = u
        } else {
          this.inicioTramo[t] = u
          this.finTramo[t] = v
        }
      }
    }

    // Cada segmento de la geometria se dibuja como un par de puntos (GL_LINES).
    let segmentos = 0
    for (let t = 0; t < red.tramos; t++) {
      segmentos += red.geoDesplazamientos[t + 1] - red.geoDesplazamientos[t] - 1
    }
    this.puntos = segmentos * 2
    this.posiciones = new Float32Array(this.puntos * 2)
    this.tramoDePunto = new Int32Array(this.puntos)
    this.fraccionDePunto = new Float32Array(this.puntos)
    this.tiempos = new Float32Array(this.puntos).fill(NO_ALCANZADO)

    const [bx, by] = red.base
    let p = 0
    const merc = new Float64Array(2)
    for (let t = 0; t < red.tramos; t++) {
      const a = red.geoDesplazamientos[t]
      const b = red.geoDesplazamientos[t + 1]
      // Longitud acumulada aproximada para interpolar el tiempo dentro del tramo.
      const acumulado: number[] = [0]
      for (let i = a + 1; i < b; i++) {
        const dx = red.geometria[2 * i] - red.geometria[2 * i - 2]
        const dy = red.geometria[2 * i + 1] - red.geometria[2 * i - 1]
        acumulado.push(acumulado[acumulado.length - 1] + Math.hypot(dx * 0.976, dy))
      }
      const total = acumulado[acumulado.length - 1] || 1
      for (let i = a; i < b - 1; i++) {
        for (const j of [i, i + 1]) {
          mercator(red.geometria[2 * j] + bx, red.geometria[2 * j + 1] + by, merc)
          this.posiciones[2 * p] = merc[0]
          this.posiciones[2 * p + 1] = merc[1]
          this.tramoDePunto[p] = t
          this.fraccionDePunto[p] = acumulado[j - a] / total
          p++
        }
      }
    }
  }

  /** Reescribe el instante de llegada de cada punto a partir de las etiquetas. */
  cargarDistancias(distancias: Float32Array): void {
    for (let p = 0; p < this.puntos; p++) {
      const t = this.tramoDePunto[p]
      const da = distancias[this.inicioTramo[t]]
      const db = distancias[this.finTramo[t]]
      if (Number.isFinite(da) && Number.isFinite(db)) {
        const f = this.fraccionDePunto[p]
        this.tiempos[p] = da + (db - da) * f
      } else if (Number.isFinite(da) || Number.isFinite(db)) {
        // Tramo de borde: solo un extremo quedo asentado.
        this.tiempos[p] = Number.isFinite(da) ? da : db
      } else {
        this.tiempos[p] = NO_ALCANZADO
      }
    }
    const gl = this.gl
    if (gl && this.bufferTiempos) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferTiempos)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.tiempos)
    }
  }

  onAdd(mapa: maplibregl.Map, gl: WebGL2RenderingContext): void {
    this.mapa = mapa
    this.gl = gl
    const programa = gl.createProgram()!
    gl.attachShader(programa, compilar(gl, gl.VERTEX_SHADER, SOMBREADOR_VERTICES))
    gl.attachShader(programa, compilar(gl, gl.FRAGMENT_SHADER, SOMBREADOR_FRAGMENTOS))
    gl.linkProgram(programa)
    if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) {
      throw new Error('No se pudo enlazar el programa WebGL: ' + gl.getProgramInfoLog(programa))
    }
    this.programa = programa
    for (const nombre of ['uMatriz', 'uFrente', 'uMaximo', 'uOpacidad']) {
      this.uniformes[nombre] = gl.getUniformLocation(programa, nombre)
    }

    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)

    this.bufferPosiciones = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferPosiciones)
    gl.bufferData(gl.ARRAY_BUFFER, this.posiciones, gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(programa, 'aPosicion')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    this.bufferTiempos = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferTiempos)
    gl.bufferData(gl.ARRAY_BUFFER, this.tiempos, gl.DYNAMIC_DRAW)
    const aTiempo = gl.getAttribLocation(programa, 'aTiempo')
    gl.enableVertexAttribArray(aTiempo)
    gl.vertexAttribPointer(aTiempo, 1, gl.FLOAT, false, 0, 0)

    gl.bindVertexArray(null)
  }

  render(gl: WebGL2RenderingContext, opciones: CustomRenderMethodInput): void {
    if (!this.programa || this.opacidad <= 0) {
      return
    }
    gl.useProgram(this.programa)
    // Bajo Mercator, mainMatrix lleva coordenadas del mundo en [0, 1] a pantalla.
    gl.uniformMatrix4fv(
      this.uniformes.uMatriz,
      false,
      opciones.defaultProjectionData.mainMatrix as unknown as Float32Array
    )
    gl.uniform1f(this.uniformes.uFrente, this.frente)
    gl.uniform1f(this.uniformes.uMaximo, this.maximo)
    gl.uniform1f(this.uniformes.uOpacidad, this.opacidad)
    gl.enable(gl.BLEND)
    // Mezcla aditiva premultiplicada: donde se cruzan calles, la luz se suma.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.LINES, 0, this.puntos)
    gl.bindVertexArray(null)
  }

  onRemove(_mapa: maplibregl.Map, gl: WebGL2RenderingContext): void {
    if (this.programa) gl.deleteProgram(this.programa)
    if (this.bufferPosiciones) gl.deleteBuffer(this.bufferPosiciones)
    if (this.bufferTiempos) gl.deleteBuffer(this.bufferTiempos)
    if (this.vao) gl.deleteVertexArray(this.vao)
  }

  repintar(): void {
    this.mapa?.triggerRepaint()
  }
}

/** Proyeccion Web Mercator normalizada a [0, 1], la misma que usa MapLibre. */
function mercator(lon: number, lat: number, salida: Float64Array): void {
  salida[0] = (180 + lon) / 360
  salida[1] =
    (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360
}

function compilar(gl: WebGL2RenderingContext, tipo: number, fuente: string): WebGLShader {
  const s = gl.createShader(tipo)!
  gl.shaderSource(s, fuente)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('Error de compilacion del sombreador: ' + gl.getShaderInfoLog(s))
  }
  return s
}
