import { describe, expect, it, beforeEach, vi } from "vitest";
import { leerVentaAgrupacionCacheada, MAX_ENTRADAS_CACHE_VENTA, MAX_LECTURAS_SIMULTANEAS, TTL_CACHE_VENTA_MS, TTL_CACHE_VENTA_NINO_MS, claveVenta, tamanioCacheVenta, vaciarCacheVenta, type ClaveVenta } from "@/lib/curvas/cache-venta";
import { huellaCargas } from "@/lib/curvas/huellas";
import { formatearDecimal, formatearPp, formatearPuntos } from "@/lib/formato";
import { fixtureVentaEstacionalidad, ABRIGO_ID, insumosFixture, parametros, PERIODOS_NINO, PEQUENA_ID, CONSTANTE_ID } from "./curvas.fixture";
import { prepararTrabajo } from "@/lib/curvas/trabajo";
import { evaluarEstadoVigente } from "@/lib/curvas/obsolescencia";
import { prerrequisitosAgrupacion } from "@/lib/curvas/prerrequisitos";

const venta = fixtureVentaEstacionalidad(ABRIGO_ID);
const clave = (extra: Partial<ClaveVenta> = {}): ClaveVenta => ({ id: ABRIGO_ID, cargas_huella: huellaCargas(venta.cargas), composicion: "k", huella_temporada: "t", ...extra });

describe("regla 58 · caché de lectura de venta", () => {
  beforeEach(() => vaciarCacheVenta());
  const cargador = () => {
    const f = vi.fn(async () => ({ data: venta, error: null as null }));
    return f;
  };
  it("con la misma clave no vuelve a llamar a la función (una llamada en dos lecturas)", async () => {
    const f = cargador();
    const a = await leerVentaAgrupacionCacheada(clave(), f);
    const b = await leerVentaAgrupacionCacheada(clave(), f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(a.cacheada).toBe(false);
    expect(b.cacheada).toBe(true);
    expect(b.data).toBe(a.data);
  });
  it("cambiar cualquiera de las tres huellas (o el id) la vuelve a llamar", async () => {
    const f = cargador();
    await leerVentaAgrupacionCacheada(clave(), f);
    for (const extra of [{ composicion: "otra" }, { huella_temporada: "otra" }, { id: "otro" }, { cargas_huella: "otra" }]) {
      await leerVentaAgrupacionCacheada(clave(extra), f);
    }
    expect(f).toHaveBeenCalledTimes(5);
  });
  it("pasada la TTL vuelve a leer; antes, no", async () => {
    const f = cargador();
    let ahora = 1_000;
    const opciones = { ahora: () => ahora };
    await leerVentaAgrupacionCacheada(clave(), f, opciones);
    ahora += TTL_CACHE_VENTA_MS - 1;
    await leerVentaAgrupacionCacheada(clave(), f, opciones);
    expect(f).toHaveBeenCalledTimes(1);
    ahora += 2;
    await leerVentaAgrupacionCacheada(clave(), f, opciones);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("guarda a lo sumo 20 entradas y expulsa la menos usada", async () => {
    const f = cargador();
    for (let i = 0; i < MAX_ENTRADAS_CACHE_VENTA; i++) await leerVentaAgrupacionCacheada(clave({ id: `a${i}` }), f);
    expect(tamanioCacheVenta()).toBe(MAX_ENTRADAS_CACHE_VENTA);
    await leerVentaAgrupacionCacheada(clave({ id: "a0" }), f); // la usa: ya no es la menos reciente
    await leerVentaAgrupacionCacheada(clave({ id: "nueva" }), f);
    expect(tamanioCacheVenta()).toBe(MAX_ENTRADAS_CACHE_VENTA);
    const llamadas = f.mock.calls.length;
    await leerVentaAgrupacionCacheada(clave({ id: "a0" }), f);
    expect(f.mock.calls.length).toBe(llamadas); // a0 sigue
    await leerVentaAgrupacionCacheada(clave({ id: "a1" }), f);
    expect(f.mock.calls.length).toBe(llamadas + 1); // a1 salió
  });
  it("nunca devuelve una entrada con otra clave: si la función devuelve cargas distintas, se guarda bajo la clave REAL", async () => {
    const otraVenta = { ...venta, cargas: { ...venta.cargas, "2024-03": "republicada" } };
    const f = vi.fn(async () => ({ data: otraVenta, error: null as null }));
    await leerVentaAgrupacionCacheada(clave(), f); // la clave pedida tenía la huella vieja
    await leerVentaAgrupacionCacheada(clave(), f); // la pedida no está: vuelve a leer
    expect(f).toHaveBeenCalledTimes(2);
    await leerVentaAgrupacionCacheada(clave({ cargas_huella: huellaCargas(otraVenta.cargas) }), f);
    expect(f).toHaveBeenCalledTimes(2); // la real sí estaba
  });
  it("junta las lecturas en curso de la misma clave: dos peticiones a la vez, una sola llamada a la base", async () => {
    let soltar: () => void = () => undefined;
    const f = vi.fn(() => new Promise<{ data: typeof venta; error: null }>((r) => { soltar = () => r({ data: venta, error: null }); }));
    const a = leerVentaAgrupacionCacheada(clave(), f);
    const b = leerVentaAgrupacionCacheada(clave(), f);
    await Promise.resolve();
    soltar();
    const [ra, rb] = await Promise.all([a, b]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(ra.data).toBe(rb.data);
  });
  it("si la lectura en curso falla, la clave se libera y la siguiente vuelve a llamar", async () => {
    const mala = vi.fn(async () => ({ data: null, error: { message: "x" } }));
    const [a, b] = await Promise.all([leerVentaAgrupacionCacheada(clave(), mala), leerVentaAgrupacionCacheada(clave(), mala)]);
    expect(a.error).toEqual({ message: "x" });
    expect(b.error).toEqual({ message: "x" });
    expect(mala).toHaveBeenCalledTimes(1);
    const buena = cargador();
    await leerVentaAgrupacionCacheada(clave(), buena);
    expect(buena).toHaveBeenCalledTimes(1);
  });
  it("a lo sumo tres lecturas de claves distintas corren a la vez", async () => {
    let activas = 0;
    let maximo = 0;
    const lento = vi.fn(async () => {
      activas += 1;
      maximo = Math.max(maximo, activas);
      await new Promise((r) => setTimeout(r, 5));
      activas -= 1;
      return { data: venta, error: null as null };
    });
    await Promise.all(Array.from({ length: 8 }, (_, i) => leerVentaAgrupacionCacheada(clave({ id: `p${i}` }), lento)));
    expect(lento).toHaveBeenCalledTimes(8);
    expect(maximo).toBeLessThanOrEqual(MAX_LECTURAS_SIMULTANEAS);
  });
  it("lo guardado se congela en profundidad (nadie puede alterar lo que verá el siguiente)", async () => {
    const r = await leerVentaAgrupacionCacheada(clave(), cargador());
    expect(Object.isFrozen(r.data)).toBe(true);
    expect(Object.isFrozen(r.data!.temporadas)).toBe(true);
    expect(Object.isFrozen(r.data!.temporadas[0])).toBe(true);
    expect(Object.isFrozen(r.data!.cargas)).toBe(true);
    expect(() => { (r.data!.meses_publicados as string[]).push("x"); }).toThrow();
  });
  it("ttl_ms acorta lo que vive una lectura (Años Niño)", async () => {
    const f = cargador();
    let ahora = 0;
    const o = { ahora: () => ahora, ttl_ms: TTL_CACHE_VENTA_NINO_MS };
    await leerVentaAgrupacionCacheada(clave({ id: null }), f, o);
    ahora = TTL_CACHE_VENTA_NINO_MS + 1;
    await leerVentaAgrupacionCacheada(clave({ id: null }), f, o);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("con error o sin datos no guarda nada", async () => {
    const f = vi.fn(async () => ({ data: null, error: { message: "x" } }));
    const r = await leerVentaAgrupacionCacheada(clave(), f);
    expect(r.error).toEqual({ message: "x" });
    expect(tamanioCacheVenta()).toBe(0);
    expect(claveVenta(clave({ id: null, composicion: "", huella_temporada: "" }))).toContain("- | ");
  });
});

describe("caso 25 · formato es-PE compartido (regla Q4)", () => {
  it("formatearPuntos y formatearPp dan el mismo texto para 27,43 y la misma coma de miles que la pantalla", () => {
    expect(formatearPuntos(27.43)).toBe("27.4");
    expect(formatearPp(27.43)).toBe(`${formatearPuntos(27.43)} pp`);
    expect(formatearPuntos(33)).toBe("33.0");
    expect(formatearDecimal(1234.567, 2)).toBe("1,234.57");
    expect(formatearDecimal(0.3, 2)).toBe("0.30");
  });
  it("ninguna frase, aviso, motivo ni prerrequisito generado por el servidor usa coma decimal (siempre el formato de la pantalla)", () => {
    const textos: string[] = [];
    for (const [id, variante] of [[ABRIGO_ID, "base"], [CONSTANTE_ID, "base"], [PEQUENA_ID, "escasa"]] as const) {
      const r = prepararTrabajo(insumosFixture(id, variante), parametros(), undefined);
      const t = r.trabajo!;
      const a = t.salida!.resultado.agrupaciones[0];
      textos.push(a.comparacion?.frase ?? "", ...a.avisos.map((x) => x.detalle), ...t.prerrequisitos.avisa.map((x) => x.detalle), ...t.prerrequisitos.bloquea.map((x) => x.detalle));
    }
    const pr = prerrequisitosAgrupacion({
      agrupacion: { id: ABRIGO_ID, nombre: "A", activo: true, temporada: "invierno", equivalencias_activas: 0 },
      versiones: 0,
      parametros: parametros(),
      meses_publicados: ["2024-01"],
      hasta_periodo: "2024-01",
      periodos: PERIODOS_NINO.slice(0, 1),
      tiendas: [],
      venta_tienda: [],
      entrada: null,
    });
    textos.push(...pr.bloquea.map((p) => p.detalle), ...pr.avisa.map((p) => p.detalle));
    const e = evaluarEstadoVigente(
      { red_comparable: [], cargas: { "2024-01": "a" }, equivalencias: 1, huella_composicion: "a", atipicos: [], temporada: "invierno", hasta_periodo: "2024-01" },
      { red_comparable: [], cargas: { "2024-01": "a", "2024-02": "b" }, equivalencias: 3, huella_composicion: "b", atipicos: ["2024-03"], temporada: "verano", tiendas: new Map(), hasta_por_defecto: "2024-01" }
    );
    textos.push(...e.motivos.map((m) => m.detalle), ...e.avisos.map((m) => m.detalle));
    const conComaDecimal = textos.filter((t) => /\d,\d{1,2}(?!\d)(?![\d,])/.test(t) && !/\d{1,3}(,\d{3})+/.test(t));
    expect(conComaDecimal).toEqual([]);
    // Y lo que lleva decimales usa el punto: la frase de la comparación trae números como 27.4.
    expect(textos.some((t) => /\d\.\d/.test(t))).toBe(true);
  });
});
