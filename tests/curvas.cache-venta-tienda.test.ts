import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_ENTRADAS_CACHE_VENTA_TIENDA,
  TTL_CACHE_VENTA_TIENDA_MS,
  leerVentaTiendaConHuella,
  tamanioCacheVentaTienda,
  vaciarCacheVentaTienda,
} from "@/lib/curvas/cache-venta-tienda";
import { leerVentaMensualTienda } from "@/lib/curvas/consultas";
import { huellaCargas } from "@/lib/curvas/huellas";
import type { VentaTiendaMes } from "@/lib/curvas/tipos";
import { clienteFalso, estadoFalso } from "./curvas.fake-db";

type Err = { code: string; message: string };
const filas = (u: number): VentaTiendaMes[] => [
  { tienda_id: "t1", periodo: "2026-08", unidades: u },
  { tienda_id: "t2", periodo: "2026-08", unidades: u + 1 },
];

/** Un par de lecturas contadas: la huella (mutable) y la carga de la base (devuelve `unidades` según el estado). */
function escenario() {
  const e = { huella: "h1", unidades: 10, huellas: 0, cargas: 0, errorCarga: null as Err | null, errorHuella: null as Err | null, alCargar: null as (() => void) | null };
  const huella = async () => {
    e.huellas += 1;
    return e.errorHuella ? { data: null, error: e.errorHuella } : { data: e.huella as string | null, error: null };
  };
  const cargar = async () => {
    e.cargas += 1;
    e.alCargar?.();
    await Promise.resolve();
    return e.errorCarga ? { data: [] as VentaTiendaMes[], error: e.errorCarga } : { data: filas(e.unidades), error: null };
  };
  return { e, huella, cargar };
}

beforeEach(() => vaciarCacheVentaTienda());

describe("caché de venta_mensual_tienda por huella de cargas", () => {
  it("dos llamadas con la misma huella leen la base una sola vez", async () => {
    const { e, huella, cargar } = escenario();
    const a = await leerVentaTiendaConHuella(huella, cargar);
    const b = await leerVentaTiendaConHuella(huella, cargar);
    expect(e.cargas).toBe(1);
    expect(a.cacheada).toBe(false);
    expect(b.cacheada).toBe(true);
    expect(b.data).toEqual(filas(10));
    expect(b.error).toBeNull();
  });

  it("dos llamadas simultáneas (como GET /api/proyeccion) comparten una sola lectura", async () => {
    const { e, huella, cargar } = escenario();
    const [a, b, c] = await Promise.all([leerVentaTiendaConHuella(huella, cargar), leerVentaTiendaConHuella(huella, cargar), leerVentaTiendaConHuella(huella, cargar)]);
    expect(e.cargas).toBe(1);
    expect(a.data).toEqual(filas(10));
    expect(b.data).toEqual(filas(10));
    expect(c.data).toEqual(filas(10));
  });

  it("cambiar la huella (publicar, retirar o republicar un mes) relee, y no devuelve lo de la otra huella", async () => {
    const { e, huella, cargar } = escenario();
    expect((await leerVentaTiendaConHuella(huella, cargar)).data).toEqual(filas(10));
    e.huella = "h2";
    e.unidades = 99;
    const nueva = await leerVentaTiendaConHuella(huella, cargar);
    expect(e.cargas).toBe(2);
    expect(nueva.data).toEqual(filas(99));
    // Volver a la huella 1 sirve lo que se leyó con la huella 1 (no lo de la 2).
    e.huella = "h1";
    const vieja = await leerVentaTiendaConHuella(huella, cargar);
    expect(vieja.data).toEqual(filas(10));
    expect(vieja.cacheada).toBe(true);
    expect(e.cargas).toBe(2);
  });

  it("si la huella cambia mientras se lee, el dato no se guarda bajo la huella vieja", async () => {
    const { e, huella, cargar } = escenario();
    e.alCargar = () => {
      e.huella = "h2"; // una publicación en medio de la lectura
      e.alCargar = null;
    };
    const r = await leerVentaTiendaConHuella(huella, cargar);
    expect(r.error).toBeNull();
    expect(tamanioCacheVentaTienda()).toBe(0);
    // La siguiente llamada (huella h2) lee de nuevo en vez de servir algo dudoso.
    await leerVentaTiendaConHuella(huella, cargar);
    expect(e.cargas).toBe(2);
    expect(tamanioCacheVentaTienda()).toBe(1);
  });

  it("un error de la lectura no se guarda y la siguiente llamada reintenta", async () => {
    const { e, huella, cargar } = escenario();
    e.errorCarga = { code: "57014", message: "canceling statement due to statement timeout" };
    const mala = await leerVentaTiendaConHuella(huella, cargar);
    expect(mala.error).toEqual(e.errorCarga);
    expect(tamanioCacheVentaTienda()).toBe(0);
    e.errorCarga = null;
    const buena = await leerVentaTiendaConHuella(huella, cargar);
    expect(buena.error).toBeNull();
    expect(e.cargas).toBe(2);
  });

  it("sin huella legible lee directo de la base y no guarda nada", async () => {
    const { e, huella, cargar } = escenario();
    e.errorHuella = { code: "XX000", message: "boom" };
    const a = await leerVentaTiendaConHuella(huella, cargar);
    const b = await leerVentaTiendaConHuella(huella, cargar);
    expect(a.data).toEqual(filas(10));
    expect(b.data).toEqual(filas(10));
    expect(e.cargas).toBe(2);
    expect(tamanioCacheVentaTienda()).toBe(0);
  });

  it("caduca a los 5 minutos aunque la huella no cambie", async () => {
    const { e, huella, cargar } = escenario();
    let t = 1_000;
    const ahora = () => t;
    await leerVentaTiendaConHuella(huella, cargar, { ahora });
    t += TTL_CACHE_VENTA_TIENDA_MS - 1;
    expect((await leerVentaTiendaConHuella(huella, cargar, { ahora })).cacheada).toBe(true);
    t += 2;
    expect((await leerVentaTiendaConHuella(huella, cargar, { ahora })).cacheada).toBe(false);
    expect(e.cargas).toBe(2);
  });

  it("guarda a lo sumo 2 entradas (la menos usada sale primero)", async () => {
    const { e, huella, cargar } = escenario();
    expect(MAX_ENTRADAS_CACHE_VENTA_TIENDA).toBe(2);
    for (const h of ["a", "b", "c"]) {
      e.huella = h;
      await leerVentaTiendaConHuella(huella, cargar);
    }
    expect(tamanioCacheVentaTienda()).toBe(2);
    e.huella = "a"; // la más antigua salió
    expect((await leerVentaTiendaConHuella(huella, cargar)).cacheada).toBe(false);
  });

  it("lo guardado no se altera desde fuera: cada lectura recibe copias", async () => {
    const { huella, cargar } = escenario();
    const a = await leerVentaTiendaConHuella(huella, cargar);
    a.data[0].unidades = -1;
    a.data.pop();
    const b = await leerVentaTiendaConHuella(huella, cargar);
    expect(b.data).toEqual(filas(10));
    b.data.sort((x, y) => y.unidades - x.unidades); // ordenar en el sitio no rompe nada
    expect((await leerVentaTiendaConHuella(huella, cargar)).data).toEqual(filas(10));
  });
});

describe("leerVentaMensualTienda (consultas) con la base falsa", () => {
  const carga = (periodo: string, id: string) => ({ id, periodo: `${periodo}-01`, estado: "publicada" });
  const sembrar = (cargas: ReturnType<typeof carga>[]) => {
    estadoFalso.tablas = { cargas_venta_stock: cargas as never };
    estadoFalso.ventaTienda = [{ tienda_id: "t1", periodo: "2026-08-01", unidades: 5 }];
  };
  const db = () => clienteFalso() as never;

  beforeEach(() => {
    estadoFalso.llamadasVentaTienda = 0;
  });

  it("dos lecturas con las mismas cargas publicadas llaman una vez a la función; publicar otro mes la vuelve a llamar", async () => {
    sembrar([carga("2026-08", "c8")]);
    const a = await leerVentaMensualTienda(db());
    const b = await leerVentaMensualTienda(db());
    expect(estadoFalso.llamadasVentaTienda).toBe(1);
    expect(a).toEqual({ data: [{ tienda_id: "t1", periodo: "2026-08", unidades: 5 }], error: null });
    expect(b).toEqual(a);
    expect(huellaCargas({ "2026-08": "c8" })).toMatch(/^[0-9a-f]{32}$/);

    sembrar([carga("2026-08", "c8"), carga("2026-09", "c9")]);
    await leerVentaMensualTienda(db());
    expect(estadoFalso.llamadasVentaTienda).toBe(2);
    // Republicar agosto (otro carga_id) también cambia la huella.
    sembrar([carga("2026-08", "c8-bis"), carga("2026-09", "c9")]);
    await leerVentaMensualTienda(db());
    expect(estadoFalso.llamadasVentaTienda).toBe(3);
    // Retirar septiembre también.
    sembrar([carga("2026-08", "c8-bis")]);
    await leerVentaMensualTienda(db());
    expect(estadoFalso.llamadasVentaTienda).toBe(4);
  });
});
