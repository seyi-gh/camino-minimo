/**
 * monticulo.ts
 *
 * Monticulo binario de minimos sobre pares (vertice, prioridad).
 *
 * En el modo academico Dijkstra busca el minimo recorriendo las n etiquetas,
 * O(n) por iteracion y O(n^2) en total: con 15 vertices es lo mas claro.
 * En la red real esa busqueda haria O(n^2) ~ 10^10 operaciones. Con un
 * monticulo cada extraccion cuesta O(log n) y el total es O((n + m) log n).
 *
 * Se usa insercion perezosa: si la etiqueta de un vertice mejora, se inserta
 * de nuevo en lugar de reordenar; al extraer, las entradas viejas se descartan
 * comparando con la etiqueta vigente.
 */

export class Monticulo {
  private vertices: Int32Array
  private prioridades: Float64Array
  private tamano = 0

  constructor(capacidad = 1024) {
    this.vertices = new Int32Array(capacidad)
    this.prioridades = new Float64Array(capacidad)
  }

  get vacio(): boolean {
    return this.tamano === 0
  }

  get longitud(): number {
    return this.tamano
  }

  vaciar(): void {
    this.tamano = 0
  }

  insertar(vertice: number, prioridad: number): void {
    if (this.tamano === this.vertices.length) {
      this.crecer()
    }
    let i = this.tamano++
    const vs = this.vertices
    const ps = this.prioridades
    while (i > 0) {
      const padre = (i - 1) >> 1
      if (ps[padre] <= prioridad) {
        break
      }
      vs[i] = vs[padre]
      ps[i] = ps[padre]
      i = padre
    }
    vs[i] = vertice
    ps[i] = prioridad
  }

  /** Prioridad del minimo. Infinity si esta vacio. */
  get prioridadMinima(): number {
    return this.tamano === 0 ? Infinity : this.prioridades[0]
  }

  /** Extrae el vertice de menor prioridad. Llamar solo si no esta vacio. */
  extraer(): number {
    const vs = this.vertices
    const ps = this.prioridades
    const raiz = vs[0]
    const n = --this.tamano
    if (n > 0) {
      const v = vs[n]
      const p = ps[n]
      let i = 0
      while (true) {
        let hijo = 2 * i + 1
        if (hijo >= n) {
          break
        }
        if (hijo + 1 < n && ps[hijo + 1] < ps[hijo]) {
          hijo++
        }
        if (ps[hijo] >= p) {
          break
        }
        vs[i] = vs[hijo]
        ps[i] = ps[hijo]
        i = hijo
      }
      vs[i] = v
      ps[i] = p
    }
    return raiz
  }

  private crecer(): void {
    const vs = new Int32Array(this.vertices.length * 2)
    const ps = new Float64Array(this.prioridades.length * 2)
    vs.set(this.vertices)
    ps.set(this.prioridades)
    this.vertices = vs
    this.prioridades = ps
  }
}
