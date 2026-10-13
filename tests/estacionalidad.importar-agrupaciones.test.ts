import { describe, expect, it } from "vitest";
import {
  aplicarPlanAgrupaciones,
  leerOrdenImportado,
  planificarImportacionAgrupaciones,
  separarGeneros,
  siguienteOrden,
  type EstadoImportacionAgrupaciones,
} from "@/lib/estacionalidad/importar-agrupaciones";
import { importarAgrupacionesSchema } from "@/lib/estacionalidad/esquemas";
import {
  ETIQUETA_MOTIVO_OMISION_AGRUPACIONES,
  type FilaImportacionAgrupaciones,
  type MotivoOmisionAgrupaciones,
} from "@/lib/estacionalidad/tipos-api";

/** Estado sintético: tres géneros (uno inactivo) y dos agrupaciones (una inactiva). Nada es de Lukers. */
const estadoFx = (): EstadoImportacionAgrupaciones => ({
  generos: [
    { id: "g-m", codigo: "M", nombre: "MUJER", orden: 20, activo: true },
    { id: "g-h", codigo: "H", nombre: "HOMBRE", orden: 10, activo: true },
    { id: "g-n", codigo: "NINOS", nombre: "NIÑOS", orden: 30, activo: true },
    { id: "g-x", codigo: "OTROS", nombre: "OTROS", orden: 80, activo: false },
  ],
  agrupaciones: [
    { codigo: "PANTALONES_INVIERNO", nombre: "PANTALONES INVIERNO", orden: 30, activo: true },
    { codigo: "VIEJA", nombre: "VIEJA", orden: 20, activo: false },
  ],
});

const fila = (nombre: string, generos = "HOMBRE", extra: Partial<FilaImportacionAgrupaciones> = {}): FilaImportacionAgrupaciones => ({
  nombre,
  generos,
  ...extra,
});

const planificar = (filas: FilaImportacionAgrupaciones[], estado = estadoFx()) => planificarImportacionAgrupaciones(filas, estado);
const motivos = (filas: FilaImportacionAgrupaciones[], estado = estadoFx()) =>
  planificar(filas, estado).reporte.omitidas.map((o) => o.motivo);

describe("agrupaciones nuevas: lo que se crea", () => {
  it("una fila mínima crea la agrupación con código derivado, todo_el_ano y géneros con nombre", () => {
    const plan = planificar([fila("  polo manga corta ", "hombre")]);
    expect(plan.reporte.omitidas).toEqual([]);
    expect(plan.crear).toEqual([
      {
        nombre: "POLO MANGA CORTA",
        codigo: "POLO_MANGA_CORTA",
        descripcion: null,
        orden: 40,
        temporada: "todo_el_ano",
        genero_ids: ["g-h"],
      },
    ]);
    expect(plan.reporte.agrupaciones_nuevas).toEqual([
      { fila: 1, nombre: "POLO MANGA CORTA", codigo: "POLO_MANGA_CORTA", generos: ["HOMBRE"], temporada: "todo_el_ano", orden: 40, descripcion: null },
    ]);
    expect(plan.reporte.totales).toEqual({ filas: 1, a_crear: 1, creadas: 0, ya_existen: 0, omitidas: 0, con_error: 0 });
  });

  it("usa el código y la descripción del archivo (código normalizado, descripción recortada)", () => {
    const plan = planificar([fila("Casacas", "MUJER", { codigo: " cas-01 ", descripcion: "  Pico en mayo.  " })]);
    expect(plan.crear[0]).toMatchObject({ codigo: "CAS_01", descripcion: "Pico en mayo." });
  });

  it("descripción vacía o solo espacios, null y columnas ausentes → null / valores por defecto", () => {
    const plan = planificar([
      fila("A1", "H", { descripcion: "   ", codigo: "", temporada: null, orden: null }),
      fila("A2", "H", { descripcion: null }),
    ]);
    expect(plan.crear.map((c) => c.descripcion)).toEqual([null, null]);
    expect(plan.crear.map((c) => c.temporada)).toEqual(["todo_el_ano", "todo_el_ano"]);
  });
});

describe("orden automático", () => {
  it("siguiente múltiplo de 10 tras el mayor orden actual, creciente por fila", () => {
    // El mayor orden del estado es 30.
    const plan = planificar([fila("A"), fila("B"), fila("C")]);
    expect(plan.crear.map((c) => c.orden)).toEqual([40, 50, 60]);
  });

  it("sin agrupaciones o con mayor 0 empieza en 10; un mayor no múltiplo sube al siguiente múltiplo", () => {
    const vacio: EstadoImportacionAgrupaciones = { ...estadoFx(), agrupaciones: [] };
    expect(planificar([fila("A"), fila("B")], vacio).crear.map((c) => c.orden)).toEqual([10, 20]);
    const con25: EstadoImportacionAgrupaciones = {
      ...estadoFx(),
      agrupaciones: [{ codigo: "X", nombre: "X", orden: 25, activo: false }],
    };
    expect(planificar([fila("A")], con25).crear[0].orden).toBe(30);
    expect(siguienteOrden(0)).toBe(10);
    expect(siguienteOrden(20)).toBe(30);
    expect(siguienteOrden(25)).toBe(30);
  });

  it("un orden explícito se respeta y los automáticos siguientes continúan por encima", () => {
    const plan = planificar([fila("A", "H", { orden: "100" }), fila("B"), fila("C", "H", { orden: 5 }), fila("D")]);
    expect(plan.crear.map((c) => c.orden)).toEqual([100, 110, 5, 120]);
  });

  it("una fila rechazada no consume número", () => {
    const plan = planificar([fila("A"), fila("B", "NOEXISTE"), fila("C")]);
    expect(plan.crear.map((c) => [c.nombre, c.orden])).toEqual([
      ["A", 40],
      ["C", 50],
    ]);
  });

  it("tope de Postgres: si el siguiente múltiplo de 10 ya no cabe en un integer, la fila sale con orden_invalido y no consume nada", () => {
    expect(siguienteOrden(2_147_483_630)).toBe(2_147_483_640);
    expect(siguienteOrden(2_147_483_640)).toBeNull();
    expect(siguienteOrden(2_147_483_647)).toBeNull();
    const alLimite: EstadoImportacionAgrupaciones = {
      ...estadoFx(),
      agrupaciones: [{ codigo: "TOPE", nombre: "TOPE", orden: 2_147_483_640, activo: true }],
    };
    const plan = planificar([fila("A"), fila("B", "H", { orden: "5" }), fila("C")], alLimite);
    expect(plan.crear.map((c) => [c.nombre, c.orden])).toEqual([["B", 5]]);
    expect(plan.reporte.omitidas.map((o) => [o.fila, o.motivo, o.informativa])).toEqual([
      [1, "orden_invalido", false],
      [3, "orden_invalido", false],
    ]);
    expect(plan.reporte.omitidas[0].detalle).toContain("2147483647");
    // Un orden explícito pasado del integer también se rechaza.
    expect(motivos([fila("D", "H", { orden: "2147483648" })])).toEqual(["orden_invalido"]);
    expect(planificar([fila("E", "H", { orden: "2147483647" })]).crear[0].orden).toBe(2_147_483_647);
  });

  it("acepta enteros ≥ 0 como texto, con decimal cero o como número; rechaza el resto", () => {
    expect(leerOrdenImportado("")).toBeNull();
    expect(leerOrdenImportado(undefined)).toBeNull();
    expect(leerOrdenImportado("0")).toBe(0);
    expect(leerOrdenImportado("30.0")).toBe(30);
    expect(leerOrdenImportado("30,0")).toBe(30);
    expect(leerOrdenImportado(40)).toBe(40);
    for (const malo of ["-1", "1.5", "abc", "1e3", "99999999999"]) expect(leerOrdenImportado(malo), malo).toBe("invalido");
  });
});

describe("géneros", () => {
  it("separa por coma, punto y coma, barra y | mezclados, sin repetir y sin vacíos", () => {
    expect(separarGeneros(" hombre , mujer;niños | h / ; ")).toEqual(["HOMBRE", "MUJER", "NIÑOS", "H"]);
    expect(separarGeneros("")).toEqual([]);
    expect(separarGeneros(undefined)).toEqual([]);
  });

  it("varios géneros con separadores mixtos, nombres y códigos, salen en el orden del catálogo", () => {
    const plan = planificar([fila("MIXTA", "niños; M | hombre / MUJER, h")]);
    expect(plan.reporte.omitidas).toEqual([]);
    expect(plan.crear[0].genero_ids).toEqual(["g-h", "g-m", "g-n"]);
    expect(plan.reporte.agrupaciones_nuevas[0].generos).toEqual(["HOMBRE", "MUJER", "NIÑOS"]);
  });

  it("un nombre de género con barra se resuelve entero antes de partirlo", () => {
    const estado = estadoFx();
    estado.generos.push({ id: "g-u", codigo: "UNI", nombre: "HOMBRE/MUJER", orden: 40, activo: true });
    const plan = planificar([fila("UNISEX", "Hombre/Mujer")], estado);
    expect(plan.crear[0].genero_ids).toEqual(["g-u"]);
  });

  it("un género con barra mezclado con otros: gana el nombre completo antes de partir por /", () => {
    const estado = estadoFx();
    estado.generos.push({ id: "g-u", codigo: "UNI", nombre: "HOMBRE/MUJER", orden: 40, activo: true });
    const plan = planificar([fila("A", "HOMBRE/MUJER, NIÑOS"), fila("B", "niños | Hombre / Mujer"), fila("C", "HOMBRE/NIÑOS")], estado);
    expect(plan.crear.map((c) => [c.nombre, c.genero_ids])).toEqual([
      ["A", ["g-n", "g-u"]],
      ["B", ["g-n", "g-u"]],
      ["C", ["g-h", "g-n"]],
    ]);
    expect(separarGeneros("HOMBRE/MUJER/NIÑOS, M", estado.generos)).toEqual(["HOMBRE/MUJER", "NIÑOS", "M"]);
    // Sin ese género en el catálogo, la barra separa como siempre.
    expect(separarGeneros("HOMBRE/MUJER, NIÑOS")).toEqual(["HOMBRE", "MUJER", "NIÑOS"]);
  });

  it("lo que no se puede resolver no se ignora: sale genero_desconocido con el texto sin resolver", () => {
    const estado = estadoFx();
    estado.generos.push({ id: "g-u", codigo: "UNI", nombre: "HOMBRE/MUJER", orden: 40, activo: true });
    const plan = planificar([fila("A", "HOMBRE/MUJER, ZAPATOS/GORROS, NIÑOS")], estado);
    expect(plan.crear).toEqual([]);
    expect(plan.reporte.omitidas[0]).toMatchObject({ motivo: "genero_desconocido", detalle: "ZAPATOS, GORROS" });
  });

  it("vacío o solo separadores → genero_vacio", () => {
    expect(motivos([fila("A", ""), fila("B", " , ; "), fila("C", "   ")])).toEqual(["genero_vacio", "genero_vacio", "genero_vacio"]);
  });

  it("desconocido lista los que faltan; una sola desconocida basta para no crear nada", () => {
    const plan = planificar([fila("A", "HOMBRE, ZAPATOS, GORROS")]);
    expect(plan.crear).toEqual([]);
    expect(plan.reporte.omitidas[0]).toMatchObject({ motivo: "genero_desconocido", detalle: "ZAPATOS, GORROS", informativa: false });
  });

  it("inactivo (por nombre o por código)", () => {
    const plan = planificar([fila("A", "HOMBRE; OTROS"), fila("B", "otros")]);
    expect(plan.reporte.omitidas.map((o) => [o.motivo, o.detalle])).toEqual([
      ["genero_inactivo", "OTROS"],
      ["genero_inactivo", "OTROS"],
    ]);
  });

  it("desconocido tiene prioridad sobre inactivo en la misma celda", () => {
    expect(motivos([fila("A", "OTROS, ZAPATOS")])).toEqual(["genero_desconocido"]);
  });
});

describe("temporada", () => {
  it("lee nombres, variantes y códigos; vacía → todo_el_ano", () => {
    const valores = ["Invierno", "VERANO", "Todo el año", "Toda temporada", "invierno", "todo_el_ano", ""];
    const plan = planificar(valores.map((t, i) => fila(`T${i}`, "H", { temporada: t })));
    expect(plan.crear.map((c) => c.temporada)).toEqual([
      "invierno",
      "verano",
      "todo_el_ano",
      "todo_el_ano",
      "invierno",
      "todo_el_ano",
      "todo_el_ano",
    ]);
  });

  it("un valor que no es temporada → temporada_invalida con el valor", () => {
    const plan = planificar([fila("A", "H", { temporada: "primavera" })]);
    expect(plan.reporte.omitidas[0]).toMatchObject({ motivo: "temporada_invalida", detalle: "PRIMAVERA" });
  });
});

describe("orden, descripción, nombre y código inválidos", () => {
  it("orden_invalido", () => {
    const plan = planificar([fila("A", "H", { orden: "-5" }), fila("B", "H", { orden: "diez" })]);
    expect(plan.reporte.omitidas.map((o) => [o.motivo, o.detalle])).toEqual([
      ["orden_invalido", "-5"],
      ["orden_invalido", "diez"],
    ]);
  });

  it("descripcion_larga solo pasa de 500 (500 exactos valen)", () => {
    const plan = planificar([fila("A", "H", { descripcion: "x".repeat(501) }), fila("B", "H", { descripcion: "x".repeat(500) })]);
    expect(plan.reporte.omitidas.map((o) => o.motivo)).toEqual(["descripcion_larga"]);
    expect(plan.crear.map((c) => c.nombre)).toEqual(["B"]);
  });

  it("nombre_vacio, fila_total (en cualquier caja) y nombre_largo", () => {
    const plan = planificar([fila("   "), fila("total"), fila("N".repeat(121))]);
    expect(plan.reporte.omitidas.map((o) => o.motivo)).toEqual(["nombre_vacio", "fila_total", "nombre_largo"]);
    expect(planificar([fila("N".repeat(120))]).crear).toHaveLength(1);
  });

  it("codigo_invalido: sin letras ni números, más de 40 caracteres o nombre que no deriva código", () => {
    const plan = planificar([
      fila("A", "H", { codigo: "---" }),
      fila("B", "H", { codigo: "C".repeat(41) }),
      fila("---", "H"),
      fila("D", "H", { codigo: "C".repeat(40) }),
    ]);
    expect(plan.reporte.omitidas.map((o) => o.motivo)).toEqual(["codigo_invalido", "codigo_invalido", "codigo_invalido"]);
    expect(plan.crear.map((c) => c.nombre)).toEqual(["D"]);
  });

  it("codigo_en_uso: un código explícito que ya tiene otra agrupación de nombre distinto", () => {
    const plan = planificar([fila("OTRA COSA", "H", { codigo: "pantalones invierno" }), fila("VIEJA 2", "H", { codigo: "VIEJA" })]);
    expect(plan.reporte.omitidas.map((o) => [o.motivo, o.detalle, o.informativa])).toEqual([
      ["codigo_en_uso", "Lo tiene la agrupación PANTALONES INVIERNO.", false],
      ["codigo_en_uso", "Lo tiene la agrupación VIEJA.", false],
    ]);
  });
});

describe("existentes: nunca se actualizan", () => {
  it("el mismo nombre normalizado → ya_existe informativa, aunque el resto de la fila traiga otros datos", () => {
    const plan = planificar([
      fila("pantalones   invierno", "MUJER", { temporada: "verano", codigo: "OTRO", orden: "5", descripcion: "nueva" }),
    ]);
    expect(plan.crear).toEqual([]);
    expect(plan.reporte.omitidas[0]).toMatchObject({ motivo: "ya_existe", informativa: true, nombre: "PANTALONES INVIERNO" });
    expect(plan.reporte.omitidas[0].detalle).toBeUndefined();
    expect(plan.reporte.totales).toMatchObject({ a_crear: 0, ya_existen: 1, omitidas: 1, con_error: 0 });
  });

  it("ya_existe gana a los errores de la fila (género desconocido, temporada inválida): no hay nada que corregir", () => {
    expect(motivos([fila("PANTALONES INVIERNO", "NOEXISTE", { temporada: "x", orden: "y" })])).toEqual(["ya_existe"]);
  });

  it("sin CODIGO en el archivo, el mismo código derivado cuenta como existente", () => {
    const plan = planificar([fila("Pantalones-Invierno", "H")]);
    expect(plan.reporte.omitidas[0]).toMatchObject({ motivo: "ya_existe", informativa: true });
    expect(plan.reporte.omitidas[0].detalle).toBe("Ya existe como PANTALONES INVIERNO.");
  });

  it("una existente inactiva también es ya_existe y se anota que no se reactiva", () => {
    const plan = planificar([fila("vieja", "H")]);
    expect(plan.reporte.omitidas[0]).toMatchObject({ motivo: "ya_existe", informativa: true });
    expect(plan.reporte.omitidas[0].detalle).toBe("Está inactiva y no se reactiva.");
    expect(plan.crear).toEqual([]);
  });
});

describe("duplicados dentro del archivo: gana la primera fila", () => {
  it("nombre repetido idéntico → informativa con fila_original", () => {
    const plan = planificar([fila("Capas", "H, M", { temporada: "Invierno" }), fila("CAPAS", "m; h", { temporada: "invierno" })]);
    expect(plan.crear.map((c) => c.nombre)).toEqual(["CAPAS"]);
    expect(plan.reporte.omitidas).toHaveLength(1);
    expect(plan.reporte.omitidas[0]).toMatchObject({
      fila: 2,
      motivo: "nombre_repetido_en_archivo",
      fila_original: 1,
      informativa: true,
      detalle: "Idéntica a la fila 1.",
    });
    expect(plan.reporte.totales).toMatchObject({ a_crear: 1, omitidas: 1, con_error: 0, ya_existen: 0 });
  });

  it("la huella usa los géneros ya resueltos: HOMBRE/MUJER (uno) no es lo mismo que HOMBRE, MUJER (dos)", () => {
    const estado = estadoFx();
    estado.generos.push({ id: "g-u", codigo: "UNI", nombre: "HOMBRE/MUJER", orden: 40, activo: true });
    const plan = planificar(
      [
        fila("Mixta", "HOMBRE/MUJER, NIÑOS"),
        fila("Mixta", "NIÑOS; UNI"), // mismo conjunto resuelto (nombre vs código y otro orden) → idéntica
        fila("Mixta", "HOMBRE, MUJER, NIÑOS"), // dos géneros distintos del anterior → difiere
      ],
      estado
    );
    expect(plan.crear).toHaveLength(1);
    expect(plan.reporte.omitidas.map((o) => [o.fila, o.informativa, o.detalle])).toEqual([
      [2, true, "Idéntica a la fila 1."],
      [3, false, "Difiere de la fila 1 en géneros; se usa la de la fila 1."],
    ]);
  });

  it("nombre repetido con datos distintos → error que dice en qué difiere; se usa la primera", () => {
    const plan = planificar([fila("Capas", "H", { temporada: "invierno" }), fila("Capas", "H, M", { temporada: "verano" })]);
    expect(plan.crear).toHaveLength(1);
    expect(plan.crear[0]).toMatchObject({ temporada: "invierno", genero_ids: ["g-h"] });
    expect(plan.reporte.omitidas[0]).toMatchObject({
      motivo: "nombre_repetido_en_archivo",
      informativa: false,
      fila_original: 1,
      detalle: "Difiere de la fila 1 en géneros, temporada; se usa la de la fila 1.",
    });
    expect(plan.reporte.totales.con_error).toBe(1);
  });

  it("codigo_repetido_en_archivo: nombres distintos con el mismo código (explícito o derivado)", () => {
    const plan = planificar([
      fila("Polo M/C", "H"),
      fila("Polo M C", "H"),
      fila("Otra", "H", { codigo: "POLO_M_C" }),
      fila("Tercera", "H", { codigo: "terc" }),
      fila("Cuarta", "H", { codigo: "TERC" }),
    ]);
    expect(plan.crear.map((c) => c.nombre)).toEqual(["POLO M/C", "TERCERA"]);
    expect(plan.reporte.omitidas.map((o) => [o.fila, o.motivo, o.fila_original, o.informativa])).toEqual([
      [2, "codigo_repetido_en_archivo", 1, false],
      [3, "codigo_repetido_en_archivo", 1, false],
      [5, "codigo_repetido_en_archivo", 4, false],
    ]);
  });

  it("una fila rechazada no reserva nombre ni código: la siguiente con ese nombre se crea", () => {
    const plan = planificar([fila("Capas", "ZAPATOS", { codigo: "CAP" }), fila("Capas", "H", { codigo: "CAP" })]);
    expect(plan.reporte.omitidas.map((o) => o.motivo)).toEqual(["genero_desconocido"]);
    expect(plan.crear.map((c) => [c.nombre, c.codigo])).toEqual([["CAPAS", "CAP"]]);
  });
});

describe("idempotencia", () => {
  const archivo = [
    fila("Capas", "H, M", { temporada: "Invierno", descripcion: "Abrigos", orden: "50" }),
    fila("Bermudas", "H", { temporada: "Verano" }),
    fila("Faldas", "MUJER"),
    fila("Mal genero", "ZAPATOS"),
    fila("PANTALONES INVIERNO", "H"),
  ];

  it("reimportar el mismo archivo da 0 a crear: todo lo creado pasa a ya_existe", () => {
    const estado = estadoFx();
    const primera = planificarImportacionAgrupaciones(archivo, estado);
    expect(primera.reporte.totales).toMatchObject({ a_crear: 3, ya_existen: 1, con_error: 1, omitidas: 2 });

    const despues = aplicarPlanAgrupaciones(estado, primera);
    expect(despues.agrupaciones).toHaveLength(estado.agrupaciones.length + 3);
    expect(estado.agrupaciones).toHaveLength(2); // no muta el estado recibido

    const segunda = planificarImportacionAgrupaciones(archivo, despues);
    expect(segunda.crear).toEqual([]);
    expect(segunda.reporte.totales).toMatchObject({ a_crear: 0, ya_existen: 4, con_error: 1, omitidas: 5 });
    expect(segunda.reporte.omitidas.filter((o) => o.motivo === "ya_existe").map((o) => o.nombre)).toEqual([
      "CAPAS",
      "BERMUDAS",
      "FALDAS",
      "PANTALONES INVIERNO",
    ]);
  });

  it("aplicar dos veces el mismo plan no duplica", () => {
    const estado = estadoFx();
    const plan = planificarImportacionAgrupaciones(archivo, estado);
    const una = aplicarPlanAgrupaciones(estado, plan);
    const dos = aplicarPlanAgrupaciones(una, plan);
    expect(dos.agrupaciones).toHaveLength(una.agrupaciones.length);
  });

  it("si un género queda inactivo después, reimportar sigue dando ya_existe (no un error)", () => {
    const estado = estadoFx();
    const despues = aplicarPlanAgrupaciones(estado, planificarImportacionAgrupaciones(archivo, estado));
    despues.generos = despues.generos.map((g) => (g.id === "g-h" ? { ...g, activo: false } : g));
    expect(planificarImportacionAgrupaciones(archivo, despues).reporte.totales.con_error).toBe(1);
  });
});

describe("reporte y contrato", () => {
  it("cada omitida lleva la fila normalizada, su número y si es informativa", () => {
    const plan = planificar([fila(" capas ", " hombre ; zapatos ", { codigo: " c-1 ", temporada: " invierno ", descripcion: " d ", orden: "7" })]);
    expect(plan.reporte.omitidas).toEqual([
      {
        fila: 1,
        motivo: "genero_desconocido",
        detalle: "ZAPATOS",
        informativa: false,
        nombre: "CAPAS",
        codigo: "C-1",
        generos: "HOMBRE ; ZAPATOS",
        temporada: "INVIERNO",
        descripcion: "d",
        orden: "7",
      },
    ]);
  });

  it("los totales cuadran: filas = a_crear + omitidas", () => {
    const plan = planificar([fila("A"), fila(""), fila("PANTALONES INVIERNO"), fila("A"), fila("B", "X")]);
    const t = plan.reporte.totales;
    expect(t.filas).toBe(5);
    expect(t.a_crear + t.omitidas).toBe(t.filas);
    expect(t.omitidas).toBe(plan.reporte.omitidas.length);
    expect(t.con_error + t.ya_existen + plan.reporte.omitidas.filter((o) => o.informativa && o.motivo !== "ya_existe").length).toBe(t.omitidas);
  });

  it("los 14 motivos aparecen en un mismo archivo y todos tienen etiqueta en español", () => {
    const largo = "x".repeat(501);
    const filas: FilaImportacionAgrupaciones[] = [
      fila(""), // nombre_vacio
      fila("N".repeat(121)), // nombre_largo
      fila("TOTAL"), // fila_total
      fila("G1", ""), // genero_vacio
      fila("G2", "NOEXISTE"), // genero_desconocido
      fila("G3", "OTROS"), // genero_inactivo
      fila("T1", "H", { temporada: "otoño" }), // temporada_invalida
      fila("O1", "H", { orden: "-1" }), // orden_invalido
      fila("D1", "H", { descripcion: largo }), // descripcion_larga
      fila("C1", "H", { codigo: "??" }), // codigo_invalido
      fila("C2", "H", { codigo: "VIEJA" }), // codigo_en_uso
      fila("Base", "H"), // creada
      fila("BASE", "H"), // nombre_repetido_en_archivo (informativa)
      fila("Base 2", "H", { codigo: "BASE" }), // codigo_repetido_en_archivo
      fila("PANTALONES INVIERNO"), // ya_existe
    ];
    const vistos = new Set(planificar(filas).reporte.omitidas.map((o) => o.motivo));
    const todos = Object.keys(ETIQUETA_MOTIVO_OMISION_AGRUPACIONES) as MotivoOmisionAgrupaciones[];
    expect(todos).toHaveLength(14);
    expect([...vistos].sort()).toEqual([...todos].sort());
    for (const m of todos) expect(ETIQUETA_MOTIVO_OMISION_AGRUPACIONES[m], m).toMatch(/\S/);
  });

  it("acepta filas con celdas numéricas (Excel) sin romperse", () => {
    const plan = planificar([{ nombre: "A", generos: "H", orden: 70, codigo: 123 as unknown as string }]);
    expect(plan.crear[0]).toMatchObject({ orden: 70, codigo: "123" });
  });
});

describe("esquema de la petición", () => {
  const base = { modo: "previsualizar", filas: [{ nombre: "A", generos: "H" }] };

  it("acepta la forma mínima y las columnas opcionales (texto, número o null)", () => {
    expect(importarAgrupacionesSchema.safeParse(base).success).toBe(true);
    const completa = {
      modo: "aplicar",
      filas: [{ nombre: "A", generos: "H", codigo: null, temporada: "Verano", descripcion: "d", orden: 10 }],
    };
    expect(importarAgrupacionesSchema.safeParse(completa).success).toBe(true);
  });

  it("rechaza modo desconocido, sin filas, nombre o géneros que no son texto y más de 5 000 filas", () => {
    expect(importarAgrupacionesSchema.safeParse({ ...base, modo: "x" }).success).toBe(false);
    expect(importarAgrupacionesSchema.safeParse({ ...base, filas: [] }).success).toBe(false);
    expect(importarAgrupacionesSchema.safeParse({ ...base, filas: [{ nombre: 1, generos: "H" }] }).success).toBe(false);
    expect(importarAgrupacionesSchema.safeParse({ ...base, filas: [{ nombre: "A" }] }).success).toBe(false);
    const muchas = Array.from({ length: 5_001 }, () => ({ nombre: "A", generos: "H" }));
    expect(importarAgrupacionesSchema.safeParse({ ...base, filas: muchas }).success).toBe(false);
  });
});
