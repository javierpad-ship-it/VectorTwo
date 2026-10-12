import { describe, expect, it } from "vitest";
import {
  crearEvaluadorMapeos,
  esEstadoMapeo,
  esMotivoMapeable,
  estadoMapeo,
  filtrarMapeos,
  MOTIVOS_MAPEABLES,
  planificarCrearMapeos,
  planificarImportacionMapeos,
  resumirEstados,
  type MapeoFila,
  type PlanCrearMapeos,
} from "@/lib/ventas/mapeos";
import type { CrearMapeoItem, FilaMapeoCsv } from "@/lib/ventas/tipos-mapeo";
import { ARBOL } from "./ventas.fixture";

/**
 * Lógica pura de mapeos (M5b, reglas 10 a 12 de la ficha 05b): alta, importación
 * y estado calculado. Árbol sintético de `ventas.fixture.ts`.
 *
 * Destinos útiles: e1s = HOMBRE / CASUAL / DENIM / PANTALON VARIOS (vigente),
 * e1l = …/ DENIM, e1g = … / SIN EQUIVALENCIA, e3x = equivalencia inactiva,
 * e4g = equivalencia activa en un nodo inactivo.
 */

const item = (origen: [string, string, string, string], equivalencia_id: string, extra: Partial<CrearMapeoItem> = {}): CrearMapeoItem => ({
  origen: { genero: origen[0], mundo: origen[1], linea: origen[2], equivalencia: origen[3] },
  equivalencia_id,
  ...extra,
});

const fila = (id: string, o: [string, string, string, string], equivalencia_id: string, extra: Partial<MapeoFila> = {}): MapeoFila => ({
  id,
  origen_genero: o[0],
  origen_mundo: o[1],
  origen_linea: o[2],
  origen_equivalencia: o[3],
  equivalencia_id,
  motivo_origen: null,
  nota: null,
  perfil_id: "perfil-a",
  usuario_nombre: "Ana",
  activo: true,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  ...extra,
});

const plan = (items: CrearMapeoItem[], existentes: MapeoFila[] = [], reemplazar = false) =>
  planificarCrearMapeos(items, ARBOL, existentes, { reemplazar });

function exitoso(p: PlanCrearMapeos) {
  if (p.error) throw new Error(`error inesperado: ${p.error.mensaje}`);
  return p;
}

describe("regla 10: planificarCrearMapeos", () => {
  it("crea con el origen normalizado y sustituido, el motivo derivado del resolutor y la nota recortada", () => {
    const p = exitoso(plan([item(["hombre", "casual", "denim", "jean"], "e1s", { nota: "  era JEAN  " }), item(["HOMBRE", "CASUAL", "BERMUDA", "-"], "e1l")]));
    expect(p.crear).toEqual([
      { origen: { genero: "HOMBRE", mundo: "CASUAL", linea: "DENIM", equivalencia: "JEAN" }, equivalencia_id: "e1s", motivo_origen: "equivalencia_inexistente", nota: "era JEAN" },
      { origen: { genero: "HOMBRE", mundo: "CASUAL", linea: "BERMUDA", equivalencia: "BERMUDA" }, equivalencia_id: "e1l", motivo_origen: "linea_inactiva", nota: null },
    ]);
    expect(p.actualizar).toEqual([]);
    expect(p.sinCambio).toBe(0);
  });

  it("usa el motivo que manda el cliente y deja null el del comodín", () => {
    const p = exitoso(plan([item(["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s", { motivo_origen: "nodo_inexistente" }), item(["HOMBRE", "CASUAL", "DENIM", "*"], "e1s")]));
    expect(p.crear.map((m) => m.motivo_origen)).toEqual(["nodo_inexistente", null]);
  });

  it("rechaza un origen con los tres de la terna en blanco (400)", () => {
    const p = plan([item(["", " ", "", "X"], "e1s")]);
    expect(p.error).toMatchObject({ status: 400, codigo: "origen_sin_clasificar", indice: 0 });
  });

  it("rechaza dos items con el mismo origen en la petición (400), también si difieren en caja o en `-`", () => {
    const p = plan([item(["HOMBRE", "CASUAL", "BERMUDA", "-"], "e1s"), item(["hombre", "casual", "bermuda", "BERMUDA"], "e1l")]);
    expect(p.error).toMatchObject({ status: 400, codigo: "origen_repetido_en_peticion", indice: 1 });
  });

  it("rechaza un origen que hoy resuelve ok en el árbol (409 origen_existe_en_arbol)", () => {
    const p = plan([item(["HOMBRE", "CASUAL", "DENIM", "PANTALON VARIOS"], "e1l")]);
    expect(p.error).toMatchObject({ status: 409, codigo: "origen_existe_en_arbol" });
    expect(p.error?.mensaje).toContain("ya existe en el árbol");
    // `-` y vacío se sustituyen antes de mirar el árbol
    expect(plan([item(["HOMBRE", "CASUAL", "DENIM", "DENIM"], "e1s")]).error?.codigo).toBe("origen_existe_en_arbol");
    expect(plan([item(["HOMBRE", "CASUAL", "DENIM", "SIN EQUIVALENCIA"], "e1s")]).error?.codigo).toBe("origen_existe_en_arbol");
  });

  it("el comodín `*` no se compara con el árbol: se acepta aunque la terna exista", () => {
    const p = exitoso(plan([item(["HOMBRE", "CASUAL", "DENIM", "*"], "e1s")]));
    expect(p.crear).toHaveLength(1);
  });

  it("destino inexistente (404) o no vigente (409 destino_inactivo): equivalencia, nodo, línea, género o mundo inactivos", () => {
    expect(plan([item(["HOMBRE", "CASUAL", "DENIM", "JEAN"], "no-existe")]).error).toMatchObject({ status: 404, codigo: "destino_no_existe" });
    for (const destino of ["e3x", "e4g"]) {
      expect(plan([item(["HOMBRE", "CASUAL", "DENIM", "JEAN"], destino)]).error, destino).toMatchObject({ status: 409, codigo: "destino_inactivo" });
    }
    const estado = { ...ARBOL, lineas: ARBOL.lineas.map((l) => (l.id === "l-den" ? { ...l, activo: false } : l)) };
    const p = planificarCrearMapeos([item(["XX", "YY", "ZZ", "A"], "e1s")], estado, []);
    expect(p.error).toMatchObject({ status: 409, codigo: "destino_inactivo" });
    expect(p.error?.mensaje).toContain("HOMBRE / CASUAL / DENIM / PANTALON VARIOS");
  });

  it("cualquier equivalencia vigente vale como destino, también la genérica", () => {
    const p = exitoso(plan([item(["XX", "YY", "ZZ", "A"], "e1g"), item(["XX", "YY", "ZZ", "B"], "e3g")]));
    expect(p.crear.map((m) => m.equivalencia_id)).toEqual(["e1g", "e3g"]);
  });

  it("origen que ya tiene otro destino sin `reemplazar` → 409 origen_repetido, con el destino actual en el mensaje", () => {
    const previo = fila("m1", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1l");
    const p = plan([item(["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s")], [previo]);
    expect(p.error).toMatchObject({ status: 409, codigo: "origen_repetido" });
    expect(p.error?.mensaje).toContain("HOMBRE / CASUAL / DENIM / DENIM");
  });

  it("con `reemplazar` actualiza destino y nota, conserva quién lo creó y lo reactiva", () => {
    const previo = fila("m1", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1l", { activo: false, nota: "vieja", motivo_origen: "linea_desconocida" });
    const p = exitoso(plan([item(["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s", { nota: "nueva" })], [previo], true));
    expect(p.crear).toEqual([]);
    expect(p.actualizar).toEqual([
      {
        id: "m1",
        origen: { genero: "HOMBRE", mundo: "CASUAL", linea: "DENIM", equivalencia: "JEAN" },
        equivalencia_id: "e1s",
        motivo_origen: "linea_desconocida",
        nota: "nueva",
        perfil_id: "perfil-a",
        usuario_nombre: "Ana",
      },
    ]);
  });

  it("con `reemplazar` y sin nota nueva conserva la que tenía", () => {
    const previo = fila("m1", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1l", { nota: "se queda" });
    const p = exitoso(plan([item(["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s")], [previo], true));
    expect(p.actualizar[0].nota).toBe("se queda");
  });

  it("mismo destino: sin cambio; si estaba inactivo se reactiva; con `reemplazar` y otra nota se actualiza", () => {
    const igual = fila("m1", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s");
    expect(exitoso(plan([item(["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s")], [igual])).sinCambio).toBe(1);
    expect(exitoso(plan([item(["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s", { nota: "otra" })], [igual])).sinCambio).toBe(1);
    const reactivar = exitoso(plan([item(["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s")], [{ ...igual, activo: false }]));
    expect(reactivar.actualizar.map((a) => a.id)).toEqual(["m1"]);
    const nota = exitoso(plan([item(["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s", { nota: "otra" })], [igual], true));
    expect(nota.actualizar[0].nota).toBe("otra");
  });

  it("es todo o nada: un item inválido deja la lista entera sin plan, con su índice", () => {
    const p = plan([
      item(["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s"),
      item(["HOMBRE", "CASUAL", "DENIM", "BOOTCUT"], "e1s"),
      item(["HOMBRE", "CASUAL", "DENIM", "PANTALON VARIOS"], "e1s"), // existe en el árbol
      item(["HOMBRE", "CASUAL", "DENIM", "OTRA"], "e1s"),
    ]);
    expect(p.error).toMatchObject({ codigo: "origen_existe_en_arbol", indice: 2 });
    expect("crear" in p).toBe(false);
  });

  it("acepta hasta 500 items distintos de una vez", () => {
    const items = Array.from({ length: 500 }, (_, i) => item(["HOMBRE", "CASUAL", "DENIM", `VIEJA ${i}`], "e1s"));
    expect(exitoso(plan(items)).crear).toHaveLength(500);
  });
});

describe("regla 12: estadoMapeo", () => {
  const base = { activo: true, origen: { genero: "HOMBRE", mundo: "CASUAL", linea: "DENIM", equivalencia: "JEAN" }, equivalencia_id: "e1s" };

  it("vigente", () => expect(estadoMapeo(base, ARBOL)).toBe("vigente"));

  it("inactivo gana a todo lo demás", () => {
    expect(estadoMapeo({ ...base, activo: false }, ARBOL)).toBe("inactivo");
    expect(estadoMapeo({ ...base, activo: false, equivalencia_id: "e3x", origen: { ...base.origen, equivalencia: "PANTALON VARIOS" } }, ARBOL)).toBe("inactivo");
  });

  it("obsoleto si el origen hoy resuelve ok (también con `-` o vacío ya sustituidos); gana a destino_inactivo", () => {
    const ok = { ...base, origen: { ...base.origen, equivalencia: "PANTALON VARIOS" } };
    expect(estadoMapeo(ok, ARBOL)).toBe("obsoleto");
    expect(estadoMapeo({ ...ok, equivalencia_id: "e3x" }, ARBOL)).toBe("obsoleto");
    expect(estadoMapeo({ ...base, origen: { ...base.origen, equivalencia: "DENIM" } }, ARBOL)).toBe("obsoleto");
    expect(estadoMapeo({ ...base, origen: { ...base.origen, equivalencia: "SIN EQUIVALENCIA" } }, ARBOL)).toBe("obsoleto");
  });

  it("el comodín nunca es obsoleto (sigue cubriendo las equivalencias que no resuelvan)", () => {
    expect(estadoMapeo({ ...base, origen: { ...base.origen, equivalencia: "*" } }, ARBOL)).toBe("vigente");
  });

  it("destino_inactivo si el destino no es vigente (equivalencia, nodo, línea, género o mundo; o ya no existe)", () => {
    expect(estadoMapeo({ ...base, equivalencia_id: "e3x" }, ARBOL)).toBe("destino_inactivo");
    expect(estadoMapeo({ ...base, equivalencia_id: "e4g" }, ARBOL)).toBe("destino_inactivo");
    expect(estadoMapeo({ ...base, equivalencia_id: "e-borrada" }, ARBOL)).toBe("destino_inactivo");
    const sinLinea = { ...ARBOL, lineas: ARBOL.lineas.map((l) => (l.id === "l-den" ? { ...l, activo: false } : l)) };
    expect(estadoMapeo(base, sinLinea)).toBe("destino_inactivo");
    const sinGenero = { ...ARBOL, generos: ARBOL.generos.map((g) => (g.id === "g-h" ? { ...g, activo: false } : g)) };
    expect(estadoMapeo(base, sinGenero)).toBe("destino_inactivo");
    const sinMundo = { ...ARBOL, mundos: ARBOL.mundos.map((m) => (m.id === "m-cas" ? { ...m, activo: false } : m)) };
    expect(estadoMapeo(base, sinMundo)).toBe("destino_inactivo");
  });

  it("aApi arma el destino con sus nombres y la bandera de vigente, y el estado", () => {
    const ev = crearEvaluadorMapeos(ARBOL);
    const api = ev.aApi(fila("m1", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1g", { motivo_origen: "equivalencia_inexistente", nota: "x" }));
    expect(api).toMatchObject({
      id: "m1",
      origen: { genero: "HOMBRE", mundo: "CASUAL", linea: "DENIM", equivalencia: "JEAN" },
      destino: { equivalencia_id: "e1g", genero: "HOMBRE", mundo: "CASUAL", linea: "DENIM", equivalencia: "SIN EQUIVALENCIA", es_generica: true, vigente: true },
      motivo_origen: "equivalencia_inexistente",
      nota: "x",
      usuario_nombre: "Ana",
      activo: true,
      estado: "vigente",
    });
    const roto = ev.aApi(fila("m2", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e-borrada", { motivo_origen: "desconocido" }));
    expect(roto.destino.vigente).toBe(false);
    expect(roto.motivo_origen).toBeNull(); // un motivo fuera de lista no se expone
    expect(roto.estado).toBe("destino_inactivo");
  });

  it("resumen cuenta los cuatro estados; filtrar por q (sin tildes, origen y destino) y por estado", () => {
    const ev = crearEvaluadorMapeos(ARBOL);
    const todos = [
      ev.aApi(fila("a", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s", { nota: "Pantalón viejo" })),
      ev.aApi(fila("b", ["MUJER", "URBANO", "DENIM", "X"], "e2g", { activo: false })),
      ev.aApi(fila("c", ["HOMBRE", "CASUAL", "DENIM", "PANTALON VARIOS"], "e1l")),
      ev.aApi(fila("d", ["HOMBRE", "CASUAL", "DENIM", "OTRA"], "e3x")),
    ];
    expect(resumirEstados(todos)).toEqual({ vigente: 1, inactivo: 1, obsoleto: 1, destino_inactivo: 1 });
    expect(filtrarMapeos(todos, null, null)).toHaveLength(4);
    expect(filtrarMapeos(todos, "jean", null).map((m) => m.id)).toEqual(["a"]);
    expect(filtrarMapeos(todos, "polo clasico", null).map((m) => m.id)).toEqual(["d"]); // por destino
    expect(filtrarMapeos(todos, "pantalon", null).map((m) => m.id)).toEqual(["a", "c"]); // por nota (con tilde) y por origen
    expect(filtrarMapeos(todos, null, "inactivo").map((m) => m.id)).toEqual(["b"]);
    expect(filtrarMapeos(todos, "hombre", "obsoleto").map((m) => m.id)).toEqual(["c"]);
    expect(filtrarMapeos(todos, "zzz", null)).toEqual([]);
  });

  it("los guardianes de tipo reconocen estados y motivos válidos", () => {
    expect(esEstadoMapeo("obsoleto")).toBe(true);
    expect(esEstadoMapeo("otro")).toBe(false);
    expect(MOTIVOS_MAPEABLES).toHaveLength(11);
    expect(esMotivoMapeable("clasificacion_incompleta")).toBe(true);
    expect(esMotivoMapeable("sin_clasificar")).toBe(false);
    expect(esMotivoMapeable("tienda_desconocida")).toBe(false);
  });
});

describe("regla 11: planificarImportacionMapeos", () => {
  const csv = (extra: Partial<FilaMapeoCsv> = {}): FilaMapeoCsv => ({
    ORIGEN_GENERO: "HOMBRE",
    ORIGEN_MUNDO: "CASUAL",
    ORIGEN_LINEA: "DENIM",
    ORIGEN_EQUIVALENCIA: "JEAN",
    DESTINO_GENERO: "HOMBRE",
    DESTINO_MUNDO: "CASUAL",
    DESTINO_LINEA: "DENIM",
    DESTINO_EQUIVALENCIA: "PANTALON VARIOS",
    ...extra,
  });
  const importar = (filas: FilaMapeoCsv[], existentes: MapeoFila[] = []) => planificarImportacionMapeos(filas, ARBOL, existentes);

  it("crea con origen normalizado, destino resuelto con el árbol y la nota", () => {
    const p = importar([csv({ ORIGEN_GENERO: " hombre ", NOTA: "  histórico  " })]);
    expect(p.recibidas).toBe(1);
    expect(p.omitidas).toEqual([]);
    expect(p.crear).toEqual([
      { origen: { genero: "HOMBRE", mundo: "CASUAL", linea: "DENIM", equivalencia: "JEAN" }, equivalencia_id: "e1s", motivo_origen: "equivalencia_inexistente", nota: "histórico" },
    ]);
  });

  it("ORIGEN_EQUIVALENCIA: vacío → SIN EQUIVALENCIA, `-` → nombre de ORIGEN_LINEA, `*` se conserva", () => {
    const p = importar([
      csv({ ORIGEN_LINEA: "BERMUDA", ORIGEN_EQUIVALENCIA: "" }),
      csv({ ORIGEN_LINEA: "CHOMPA", ORIGEN_EQUIVALENCIA: "-" }),
      csv({ ORIGEN_LINEA: "ZAPATO", ORIGEN_EQUIVALENCIA: "*" }),
    ]);
    expect(p.omitidas).toEqual([]);
    expect(p.crear.map((m) => m.origen.equivalencia)).toEqual(["SIN EQUIVALENCIA", "CHOMPA", "*"]);
    expect(p.crear[2].motivo_origen).toBeNull();
  });

  it("DESTINO_EQUIVALENCIA: vacío, `-` y SIN EQUIVALENCIA con las reglas del árbol", () => {
    const p = importar([
      csv({ ORIGEN_EQUIVALENCIA: "A", DESTINO_EQUIVALENCIA: "" }),
      csv({ ORIGEN_EQUIVALENCIA: "B", DESTINO_EQUIVALENCIA: "-" }),
      csv({ ORIGEN_EQUIVALENCIA: "C", DESTINO_EQUIVALENCIA: "SIN EQUIVALENCIA" }),
    ]);
    expect(p.crear.map((m) => m.equivalencia_id)).toEqual(["e1g", "e1l", "e1g"]);
  });

  it("omite con su motivo: sin clasificar, existe en el árbol, repetido, destino que no resuelve, destino inactivo", () => {
    const p = importar([
      csv({ ORIGEN_GENERO: "", ORIGEN_MUNDO: "", ORIGEN_LINEA: "" }), // 1
      csv({ ORIGEN_EQUIVALENCIA: "PANTALON VARIOS" }), // 2: existe en el árbol
      csv(), // 3: se crea
      csv(), // 4: repetido en el archivo
      csv({ ORIGEN_EQUIVALENCIA: "OTRA", DESTINO_EQUIVALENCIA: "NO EXISTE" }), // 5
      csv({ ORIGEN_EQUIVALENCIA: "OTRA2", DESTINO_GENERO: "" }), // 6: destino incompleto
      csv({ ORIGEN_EQUIVALENCIA: "OTRA3", DESTINO_GENERO: "HOMBRE", DESTINO_MUNDO: "URBANO", DESTINO_LINEA: "POLO", DESTINO_EQUIVALENCIA: "POLO CLASICO" }), // 7: inactivo
      csv({ ORIGEN_EQUIVALENCIA: "OTRA4", DESTINO_MUNDO: "RI" }), // 8: mundo inactivo
    ]);
    expect(p.omitidas.map((o) => [o.fila, o.motivo])).toEqual([
      [1, "origen_sin_clasificar"],
      [2, "origen_existe_en_arbol"],
      [4, "origen_repetido_en_archivo"],
      [5, "destino_no_resuelve"],
      [6, "destino_no_resuelve"],
      [7, "destino_inactivo"],
      [8, "destino_inactivo"],
    ]);
    expect(p.crear).toHaveLength(1);
    expect(p.omitidas.find((o) => o.fila === 5)?.detalle).toContain("NO EXISTE");
  });

  it("omite con `origen_con_comodin_invalido` el `*` en género, mundo o línea y `FOO*` en la equivalencia (lo que el POST rechaza)", () => {
    const p = importar([
      csv({ ORIGEN_GENERO: "*" }),
      csv({ ORIGEN_MUNDO: "*" }),
      csv({ ORIGEN_LINEA: "DEN*" }),
      csv({ ORIGEN_EQUIVALENCIA: "FOO*" }),
      csv({ ORIGEN_EQUIVALENCIA: "*" }), // el comodín válido sí entra
    ]);
    expect(p.omitidas.map((o) => [o.fila, o.motivo])).toEqual([
      [1, "origen_con_comodin_invalido"],
      [2, "origen_con_comodin_invalido"],
      [3, "origen_con_comodin_invalido"],
      [4, "origen_con_comodin_invalido"],
    ]);
    expect(p.crear.map((m) => m.origen.equivalencia)).toEqual(["*"]);
  });

  it("el alta también rechaza el comodín mal puesto (red de seguridad del POST)", () => {
    for (const origen of [["*", "CASUAL", "DENIM", "X"], ["HOMBRE", "*", "DENIM", "X"], ["HOMBRE", "CASUAL", "*", "X"], ["HOMBRE", "CASUAL", "DENIM", "FOO*"]] as [string, string, string, string][]) {
      expect(plan([item(origen, "e1s")]).error, origen.join("/")).toMatchObject({ status: 400, codigo: "origen_con_comodin_invalido" });
    }
  });

  it("existente_igual / existente_distinto no se actualizan; reimportar el mismo archivo crea 0", () => {
    const filas = [csv(), csv({ ORIGEN_EQUIVALENCIA: "BOOTCUT" })];
    const primera = importar(filas);
    expect(primera.crear).toHaveLength(2);
    const guardadas = primera.crear.map((m, i) =>
      fila(`m${i}`, [m.origen.genero, m.origen.mundo, m.origen.linea, m.origen.equivalencia], m.equivalencia_id)
    );
    const segunda = importar(filas, guardadas);
    expect(segunda.crear).toEqual([]);
    expect(segunda.omitidas.map((o) => o.motivo)).toEqual(["existente_igual", "existente_igual"]);
    // mismo origen con otro destino: se lista y no se toca
    const distinto = importar([csv({ DESTINO_EQUIVALENCIA: "DENIM" })], guardadas);
    expect(distinto.crear).toEqual([]);
    expect(distinto.omitidas.map((o) => o.motivo)).toEqual(["existente_distinto"]);
  });

  it("una nota de más de 200 caracteres se recorta; las filas se numeran desde 1", () => {
    const p = importar([csv({ NOTA: "x".repeat(300) })]);
    expect(p.crear[0].nota).toHaveLength(200);
    const q = importar([csv({ ORIGEN_EQUIVALENCIA: "PANTALON VARIOS" })]);
    expect(q.omitidas[0].fila).toBe(1);
  });
});
