import { describe, expect, it } from "vitest";
import { cargarMeses, type EventoCarga } from "@/lib/ventas/cargar-meses";
import { ErrorApiVentas, type ApiVentas } from "@/lib/ventas/cliente-api";
import { sustituirMarcasNuevas } from "@/lib/ventas/informe";
import type { CargaApi, PublicarRespuesta, TandaPeticion } from "@/lib/ventas/tipos-api";
import { informe as armar } from "./ventas.fixture";

/** Dos meses de 25 filas distintas cada uno (septiembre con 5 de error si se pide). */
function archivo(opciones: { erroresSet?: number } = {}) {
  const filas = [
    ...Array.from({ length: 25 }, (_, i) => ({ mes: "Ago", marca: `M${i}`, venta_soles: String(100 + i) })),
    ...Array.from({ length: 25 }, (_, i) => ({ mes: "Set", marca: `M${i}`, venta_soles: String(200 + i) })),
    ...Array.from({ length: opciones.erroresSet ?? 0 }, () => ({ mes: "Set", tienda: "LOCAL X" })),
  ];
  const r = armar(filas);
  const ids: Record<string, string> = {};
  for (let i = 0; i < 25; i++) ids[`M${i}`] = `mk-${i}`;
  return { informe: r.informe, consolidado: sustituirMarcasNuevas(r.consolidado, ids) };
}

type Registro = { llamada: string; periodo?: string; tanda?: number; solo?: boolean };

function apiFalsa(opciones: {
  falloTanda?: (periodo: string, tanda: number, intento: number) => ErrorApiVentas | null;
  falloPublicar?: (periodo: string) => ErrorApiVentas | null;
  falloAbrir?: (periodo: string) => ErrorApiVentas | null;
  /** La base publica de verdad, pero la respuesta se pierde (status 0 o 5xx). */
  publicaYPierdeRespuesta?: (periodo: string) => ErrorApiVentas | null;
  falloDetalle?: boolean;
} = {}) {
  const log: Registro[] = [];
  const cargas = new Map<string, { periodo: string; filas: number; unidades: number; venta: number; estado: string }>();
  const intentos = new Map<string, number>();
  let n = 0;
  const api: Pick<ApiVentas, "abrirCarga" | "enviarTanda" | "publicar" | "descartar" | "limpiar" | "detalle"> = {
    async abrirCarga(c) {
      log.push({ llamada: "abrir", periodo: c.periodo });
      const fallo = opciones.falloAbrir?.(c.periodo);
      if (fallo) throw fallo;
      const id = `carga-${++n}`;
      cargas.set(id, { periodo: c.periodo, filas: 0, unidades: 0, venta: 0, estado: "en_curso" });
      return { carga: { id, periodo: c.periodo } as CargaApi, reemplaza: null };
    },
    async enviarTanda(id, t: TandaPeticion) {
      const c = cargas.get(id)!;
      log.push({ llamada: "tanda", periodo: c.periodo, tanda: t.tanda });
      const clave = `${c.periodo}|${t.tanda}`;
      const intento = (intentos.get(clave) ?? 0) + 1;
      intentos.set(clave, intento);
      const fallo = opciones.falloTanda?.(c.periodo, t.tanda, intento);
      if (fallo) throw fallo;
      c.filas += t.filas.length;
      for (const f of t.filas) {
        c.unidades += f[4];
        c.venta += Math.round(f[5] * 100);
      }
      return { tanda: t.tanda, recibidas: t.filas.length };
    },
    async publicar(id, { esperado }) {
      const c = cargas.get(id)!;
      log.push({ llamada: "publicar", periodo: c.periodo });
      const fallo = opciones.falloPublicar?.(c.periodo);
      if (fallo) throw fallo;
      // La base mide lo que recibió y lo compara con lo esperado.
      expect(c.filas).toBe(esperado.filas);
      expect(c.unidades).toBe(esperado.unidades);
      expect(c.venta).toBe(Math.round(esperado.venta_soles * 100));
      const pierde = opciones.publicaYPierdeRespuesta?.(c.periodo);
      if (pierde) {
        c.estado = "publicada";
        throw pierde;
      }
      c.estado = "publicada";
      return { carga: { id } as CargaApi, medido: esperado, reemplaza: null } as PublicarRespuesta;
    },
    async descartar(id, soloEnCurso) {
      const c = cargas.get(id)!;
      log.push({ llamada: "descartar", periodo: c.periodo, solo: soloEnCurso === true });
      // Como el servidor: con `?solo=en_curso` nunca retira una publicada; sin él, sí.
      if (soloEnCurso && c.estado !== "en_curso") throw new ErrorApiVentas("no se descarta desde la carga", 409);
      c.estado = c.estado === "publicada" ? "retirada" : "abandonada";
      return { id, estado: c.estado as "retirada" | "abandonada" };
    },
    async detalle(id) {
      log.push({ llamada: "detalle", periodo: cargas.get(id)?.periodo });
      if (opciones.falloDetalle) throw new ErrorApiVentas("sin respuesta", 0);
      return { carga: { id, estado: cargas.get(id)!.estado, filas: cargas.get(id)!.filas } as CargaApi, reporte: {}, historial: [] };
    },
    async limpiar() {
      log.push({ llamada: "limpiar" });
      return { cargas_limpiadas: 0, filas_borradas: 0, pendientes: 0 };
    },
  };
  return { api, log, cargas };
}

const sinEspera = async () => undefined;

describe("cargarMeses", () => {
  it("abre, envía todas las tandas, publica y limpia, mes por mes", async () => {
    const { informe, consolidado } = archivo();
    const { api, log } = apiFalsa();
    const eventos: EventoCarga[] = [];
    const r = await cargarMeses({
      api,
      informe,
      consolidado,
      periodos: ["2026-08", "2026-09"],
      archivoNombre: "ventas.csv",
      alEvento: (e) => void eventos.push(e),
      opciones: { tamanoTanda: 10, esperaReintento: sinEspera },
    });
    expect(r.map((x) => [x.periodo, x.estado, x.filas])).toEqual([
      ["2026-08", "publicado", 25],
      ["2026-09", "publicado", 25],
    ]);
    expect(log.map((l) => l.llamada)).toEqual([
      "abrir", "tanda", "tanda", "tanda", "publicar",
      "abrir", "tanda", "tanda", "tanda", "publicar",
      "limpiar",
    ]);
    expect(eventos.filter((e) => e.estado === "cargando" && e.tanda).map((e) => `${e.tanda}/${e.tandas}`)).toEqual(["1/3", "2/3", "3/3", "1/3", "2/3", "3/3"]);
    expect(eventos.at(-1)).toMatchObject({ periodo: "2026-09", estado: "publicado" });
  });

  it("una tanda con 5xx o red caída se reintenta y el mes se publica", async () => {
    const { informe, consolidado } = archivo();
    const { api, log } = apiFalsa({
      falloTanda: (p, t, intento) =>
        p === "2026-08" && t === 2 && intento === 1 ? new ErrorApiVentas("Error 503", 503) : p === "2026-08" && t === 3 && intento <= 2 ? new ErrorApiVentas("red", 0) : null,
    });
    const r = await cargarMeses({ api, informe, consolidado, periodos: ["2026-08"], archivoNombre: "a.csv", opciones: { tamanoTanda: 10, esperaReintento: sinEspera } });
    expect(r[0]).toMatchObject({ estado: "publicado", reintentos: 3 });
    expect(log.filter((l) => l.llamada === "tanda")).toHaveLength(6);
  });

  it("tres fallos seguidos de una tanda descartan el mes y se continúa con el siguiente", async () => {
    const { informe, consolidado } = archivo();
    const { api, log } = apiFalsa({ falloTanda: (p, t) => (p === "2026-08" && t === 2 ? new ErrorApiVentas("Error 500", 500) : null) });
    const r = await cargarMeses({ api, informe, consolidado, periodos: ["2026-08", "2026-09"], archivoNombre: "a.csv", opciones: { tamanoTanda: 10, esperaReintento: sinEspera } });
    expect(r[0]).toMatchObject({ estado: "error", reintentos: 2 });
    expect(r[0].mensaje).toContain("Error 500");
    expect(r[1].estado).toBe("publicado");
    const ago = log.filter((l) => l.periodo === "2026-08").map((l) => l.llamada);
    expect(ago.filter((x) => x === "tanda")).toHaveLength(1 + 3); // tanda 1 y tres intentos de la 2
    expect(ago).toContain("descartar");
    expect(ago).not.toContain("publicar");
  });

  it("un 4xx descarta el mes sin reintentar", async () => {
    const { informe, consolidado } = archivo();
    const { api, log } = apiFalsa({ falloTanda: (p, t) => (p === "2026-08" && t === 1 ? new ErrorApiVentas("La carga caducó", 409) : null) });
    const r = await cargarMeses({ api, informe, consolidado, periodos: ["2026-08"], archivoNombre: "a.csv", opciones: { tamanoTanda: 10, esperaReintento: sinEspera } });
    expect(r[0]).toMatchObject({ estado: "error", mensaje: "La carga caducó", reintentos: 0 });
    expect(log.filter((l) => l.llamada === "tanda")).toHaveLength(1);
  });

  it("si no concilia al publicar, el error explica qué faltó", async () => {
    const { informe, consolidado } = archivo();
    const esperado = { filas: 25, unidades: 0, venta_soles: 0, costo_vendido: 0, stock_unidades: 0, stock_valorizado: 0 };
    const { api } = apiFalsa({
      falloPublicar: (p) =>
        p === "2026-08"
          ? new ErrorApiVentas("x", 409, { codigo: "no_concilia", esperado, medido: { ...esperado, filas: 15 } })
          : null,
    });
    const r = await cargarMeses({ api, informe, consolidado, periodos: ["2026-08", "2026-09"], archivoNombre: "a.csv", opciones: { tamanoTanda: 10, esperaReintento: sinEspera } });
    expect(r[0].estado).toBe("error");
    expect(r[0].mensaje).toContain("Faltan 10 filas: se perdió una tanda");
    expect(r[1].estado).toBe("publicado");
  });

  it("salta los meses idénticos a lo ya cargado, los bloqueados y los que no tienen filas", async () => {
    const { informe, consolidado } = archivo({ erroresSet: 5 });
    expect(informe.meses[1].bloqueado).toBe(true);
    const { api, log } = apiFalsa();
    const identico = { ...informe, meses: [{ ...informe.meses[0], estado: "identico" as const }, informe.meses[1]] };
    const r = await cargarMeses({ api, informe: identico, consolidado, periodos: ["2026-08", "2026-09", "2030-01"], archivoNombre: "a.csv", opciones: { esperaReintento: sinEspera } });
    expect(r.map((x) => [x.estado, x.motivo ?? x.mensaje])).toEqual([
      ["saltado", "identico"],
      ["saltado", "bloqueado"],
      ["error", "Ese mes no está en el archivo."],
    ]);
    expect(log.map((l) => l.llamada)).toEqual(["limpiar"]);
    // sin saltar idénticos, ese mes se carga
    const otra = apiFalsa();
    const r2 = await cargarMeses({ api: otra.api, informe: identico, consolidado, periodos: ["2026-08"], archivoNombre: "a.csv", opciones: { saltarIdenticos: false, esperaReintento: sinEspera } });
    expect(r2[0].estado).toBe("publicado");
  });

  it("forzar_incompleto carga el mes bloqueado y lo deja marcado", async () => {
    const { informe, consolidado } = archivo({ erroresSet: 5 });
    const abiertas: unknown[] = [];
    const { api } = apiFalsa();
    const original = api.abrirCarga;
    api.abrirCarga = async (c) => {
      abiertas.push(c);
      return original(c);
    };
    const r = await cargarMeses({ api, informe, consolidado, periodos: ["2026-09"], archivoNombre: "a.csv", opciones: { forzarIncompleto: true, tamanoTanda: 100, esperaReintento: sinEspera } });
    expect(r[0]).toMatchObject({ estado: "publicado", incompleto: true });
    expect(abiertas[0]).toMatchObject({ periodo: "2026-09", forzar_incompleto: true, reemplazar: false, mes_abierto: false });
    expect((abiertas[0] as { reporte: Record<string, unknown> }).reporte.incompleto).toMatchObject({ porcentaje: expect.any(Number) });
    expect((abiertas[0] as { archivo: { filas: number } }).archivo.filas).toBe(30);
  });

  it("cancelar a mitad descarta la carga en curso y deja el resto sin empezar", async () => {
    const { informe, consolidado } = archivo();
    const control = new AbortController();
    const { api, log } = apiFalsa({
      falloTanda: (p, t) => {
        if (p === "2026-08" && t === 2) control.abort();
        return null;
      },
    });
    const r = await cargarMeses({ api, informe, consolidado, periodos: ["2026-08", "2026-09"], archivoNombre: "a.csv", signal: control.signal, opciones: { tamanoTanda: 10, esperaReintento: sinEspera } });
    expect(r.map((x) => x.estado)).toEqual(["cancelado", "cancelado"]);
    expect(log.map((l) => l.llamada)).not.toContain("publicar");
    expect(log.filter((l) => l.llamada === "descartar")).toHaveLength(1);
  });

  it("un mes abierto y uno que ya está publicado piden confirmación en la apertura", async () => {
    const { informe, consolidado } = archivo();
    const abiertas: { reemplazar?: boolean; mes_abierto?: boolean }[] = [];
    const { api } = apiFalsa();
    const original = api.abrirCarga;
    api.abrirCarga = async (c) => {
      abiertas.push(c);
      return original(c);
    };
    const nuevo = { ...informe, meses: [{ ...informe.meses[0], estado: "reemplaza" as const, abierto: true }, informe.meses[1]] };
    await cargarMeses({ api, informe: nuevo, consolidado, periodos: ["2026-08"], archivoNombre: "a.csv", opciones: { esperaReintento: sinEspera } });
    expect(abiertas[0]).toMatchObject({ reemplazar: true, mes_abierto: true });
  });

  it("si abrir la carga falla (otra persona cargando), el mes queda en error y no se descarta nada", async () => {
    const { informe, consolidado } = archivo();
    const { api, log } = apiFalsa({ falloAbrir: (p) => (p === "2026-08" ? new ErrorApiVentas("Carga en curso de ese mes por Ana desde las 10:42.", 409) : null) });
    const r = await cargarMeses({ api, informe, consolidado, periodos: ["2026-08", "2026-09"], archivoNombre: "a.csv", opciones: { esperaReintento: sinEspera } });
    expect(r[0]).toMatchObject({ estado: "error", mensaje: "Carga en curso de ese mes por Ana desde las 10:42." });
    expect(r[1].estado).toBe("publicado");
    expect(log.filter((l) => l.llamada === "descartar")).toHaveLength(0);
  });

  describe("publicar con fallo ambiguo (no retirar un mes ya publicado)", () => {
    const una = (opc: Parameters<typeof apiFalsa>[0]) => {
      const { informe, consolidado } = archivo();
      const fake = apiFalsa(opc);
      const correr = () =>
        cargarMeses({ api: fake.api, informe, consolidado, periodos: ["2026-08"], archivoNombre: "a.csv", opciones: { tamanoTanda: 100, esperaReintento: sinEspera } });
      return { ...fake, correr };
    };

    it("si la respuesta de publicar se pierde pero el mes quedó publicado, se da por publicado y NO se descarta", async () => {
      for (const fallo of [new ErrorApiVentas("sin respuesta", 0), new ErrorApiVentas("Error 502", 502)]) {
        const { correr, log, cargas } = una({ publicaYPierdeRespuesta: () => fallo });
        const r = await correr();
        expect(r[0]).toMatchObject({ estado: "publicado", filas: 25 });
        expect(log.map((l) => l.llamada)).toContain("detalle");
        expect(log.map((l) => l.llamada)).not.toContain("descartar");
        expect([...cargas.values()][0].estado).toBe("publicada");
      }
    });

    it("si el fallo fue real y la carga sigue en curso, se descarta, y solo si sigue en curso", async () => {
      const { correr, log } = una({ falloPublicar: () => new ErrorApiVentas("Error 503", 503) });
      const r = await correr();
      expect(r[0].estado).toBe("error");
      expect(log.filter((l) => l.llamada === "descartar")).toEqual([{ llamada: "descartar", periodo: "2026-08", solo: true }]);
    });

    it("si no se puede confirmar el estado, no se descarta nada y se avisa que hay que revisarlo", async () => {
      const { correr, log, cargas } = una({ publicaYPierdeRespuesta: () => new ErrorApiVentas("sin respuesta", 0), falloDetalle: true });
      const r = await correr();
      expect(r[0].estado).toBe("error");
      expect(r[0].mensaje).toContain("Cargas por mes");
      expect(log.map((l) => l.llamada)).not.toContain("descartar");
      expect([...cargas.values()][0].estado).toBe("publicada"); // intacta
    });

    it("no_concilia y los 4xx de publicar no descartan nada", async () => {
      const e = { filas: 25, unidades: 0, venta_soles: 0, costo_vendido: 0, stock_unidades: 0, stock_valorizado: 0 };
      for (const fallo of [new ErrorApiVentas("x", 409, { codigo: "no_concilia", esperado: e, medido: { ...e, filas: 20 } }), new ErrorApiVentas("ya no está en curso", 409)]) {
        const { correr, log } = una({ falloPublicar: () => fallo });
        const r = await correr();
        expect(r[0].estado).toBe("error");
        expect(log.map((l) => l.llamada)).not.toContain("descartar");
        expect(log.map((l) => l.llamada)).not.toContain("detalle");
      }
    });

    it("el flujo de carga siempre descarta con `solo en curso`", async () => {
      const { informe, consolidado } = archivo();
      const { api, log } = apiFalsa({ falloTanda: (p, t) => (t === 1 ? new ErrorApiVentas("Error 400", 400) : null) });
      await cargarMeses({ api, informe, consolidado, periodos: ["2026-08"], archivoNombre: "a.csv", opciones: { tamanoTanda: 10, esperaReintento: sinEspera } });
      expect(log.filter((l) => l.llamada === "descartar").every((l) => l.solo === true)).toBe(true);
    });
  });

  describe("cancelar", () => {
    it("revisa la cancelación justo antes de publicar", async () => {
      const { informe, consolidado } = archivo();
      const control = new AbortController();
      const { api, log } = apiFalsa({
        falloTanda: (p, t) => {
          if (t === 3) control.abort(); // la última tanda del mes
          return null;
        },
      });
      const r = await cargarMeses({ api, informe, consolidado, periodos: ["2026-08"], archivoNombre: "a.csv", signal: control.signal, opciones: { tamanoTanda: 10, esperaReintento: sinEspera } });
      expect(r[0].estado).toBe("cancelado");
      expect(log.map((l) => l.llamada)).not.toContain("publicar");
      expect(log.filter((l) => l.llamada === "descartar")).toHaveLength(1);
    });

    it("una tanda cortada por la cancelación no se reintenta", async () => {
      const { informe, consolidado } = archivo();
      const control = new AbortController();
      const { api, log } = apiFalsa({
        falloTanda: () => {
          control.abort();
          return new ErrorApiVentas("cortada", 0);
        },
      });
      const r = await cargarMeses({ api, informe, consolidado, periodos: ["2026-08"], archivoNombre: "a.csv", signal: control.signal, opciones: { tamanoTanda: 10, esperaReintento: sinEspera } });
      expect(r[0]).toMatchObject({ estado: "cancelado", reintentos: 0 });
      expect(log.filter((l) => l.llamada === "tanda")).toHaveLength(1);
    });
  });
});
