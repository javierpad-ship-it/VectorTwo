import { describe, expect, it } from "vitest";
import {
  crearPeriodoAtipicoSchema,
  editarPeriodoAtipicoSchema,
  leerConsultaAnios,
  mes,
  temporadaAgrupacion,
} from "@/lib/curvas/esquemas";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const params = (obj: Record<string, string>) => new URLSearchParams(obj);

describe("mes (aaaa-mm)", () => {
  it("acepta 2023-03 y rechaza meses mal formados", () => {
    expect(mes.safeParse("2023-03").success).toBe(true);
    for (const malo of ["2023-13", "2023-00", "2023-3", "23-03", "2023/03", "2023-03-01", "", " 2023-03"]) {
      expect(mes.safeParse(malo).success, malo).toBe(false);
    }
  });
  it("acota el año a 2000–2100", () => {
    expect(mes.safeParse("1999-12").success).toBe(false);
    expect(mes.safeParse("2101-01").success).toBe(false);
    expect(mes.safeParse("2100-12").success).toBe(true);
  });
});

describe("crearPeriodoAtipicoSchema", () => {
  const base = { desde: "2023-03", hasta: "2023-05", motivo: "Niño costero 2023" };
  it("aplica los valores por defecto: alcance invierno y sin descripción", () => {
    expect(crearPeriodoAtipicoSchema.parse(base)).toEqual({ ...base, temporadas: ["invierno"], alcance: "invierno" });
  });
  it("motivo y descripción se recortan sin pasar a mayúsculas; descripción vacía → null", () => {
    const r = crearPeriodoAtipicoSchema.parse({ ...base, motivo: "  Niño costero 2023  ", descripcion: "   " });
    expect(r.motivo).toBe("Niño costero 2023");
    expect(r.descripcion).toBeNull();
    expect(crearPeriodoAtipicoSchema.parse({ ...base, descripcion: " algo " }).descripcion).toBe("algo");
    expect(crearPeriodoAtipicoSchema.parse({ ...base, descripcion: null }).descripcion).toBeNull();
  });
  it("rechaza hasta < desde con el mensaje de pantalla; desde = hasta vale (un mes)", () => {
    const r = crearPeriodoAtipicoSchema.safeParse({ ...base, desde: "2023-06" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("El mes final no puede ser anterior al inicial.");
    expect(crearPeriodoAtipicoSchema.safeParse({ ...base, desde: "2023-05" }).success).toBe(true);
  });
  it("rechaza meses mal formados, motivo vacío o de más de 120 y alcance fuera de invierno/todas", () => {
    expect(crearPeriodoAtipicoSchema.safeParse({ ...base, desde: "2023-13" }).success).toBe(false);
    expect(crearPeriodoAtipicoSchema.safeParse({ ...base, hasta: "2023-5" }).success).toBe(false);
    expect(crearPeriodoAtipicoSchema.safeParse({ ...base, motivo: "   " }).success).toBe(false);
    expect(crearPeriodoAtipicoSchema.safeParse({ ...base, motivo: "x".repeat(121) }).success).toBe(false);
    expect(crearPeriodoAtipicoSchema.safeParse({ ...base, motivo: "x".repeat(120) }).success).toBe(true);
    expect(crearPeriodoAtipicoSchema.safeParse({ ...base, descripcion: "x".repeat(501) }).success).toBe(false);
    expect(crearPeriodoAtipicoSchema.safeParse({ ...base, alcance: "afectadas" }).success).toBe(false);
    expect(crearPeriodoAtipicoSchema.safeParse({ ...base, alcance: "verano" }).success).toBe(false);
    expect(crearPeriodoAtipicoSchema.parse({ ...base, alcance: "todas" }).alcance).toBe("todas");
  });
  it("exige desde, hasta y motivo", () => {
    expect(crearPeriodoAtipicoSchema.safeParse({ hasta: "2023-05", motivo: "x" }).success).toBe(false);
    expect(crearPeriodoAtipicoSchema.safeParse({ desde: "2023-03", motivo: "x" }).success).toBe(false);
    expect(crearPeriodoAtipicoSchema.safeParse({ desde: "2023-03", hasta: "2023-05" }).success).toBe(false);
  });
});

describe("editarPeriodoAtipicoSchema", () => {
  it("un cuerpo vacío no vale; cualquier campo suelto sí, y los ausentes siguen ausentes", () => {
    expect(editarPeriodoAtipicoSchema.safeParse({}).success).toBe(false);
    expect(editarPeriodoAtipicoSchema.parse({ activo: false })).toEqual({ activo: false });
    expect(editarPeriodoAtipicoSchema.parse({ motivo: " Nuevo " })).toEqual({ motivo: "Nuevo" });
    expect(editarPeriodoAtipicoSchema.parse({ descripcion: "" })).toEqual({ descripcion: null });
  });
  it("si vienen desde y hasta invertidos se rechaza; si viene uno solo lo compara el handler", () => {
    expect(editarPeriodoAtipicoSchema.safeParse({ desde: "2023-06", hasta: "2023-05" }).success).toBe(false);
    expect(editarPeriodoAtipicoSchema.safeParse({ desde: "2023-06" }).success).toBe(true);
    expect(editarPeriodoAtipicoSchema.safeParse({ hasta: "2023-01" }).success).toBe(true);
  });
  it("valida cada campo", () => {
    expect(editarPeriodoAtipicoSchema.safeParse({ desde: "2023-13" }).success).toBe(false);
    expect(editarPeriodoAtipicoSchema.safeParse({ alcance: "afectadas" }).success).toBe(false);
    expect(editarPeriodoAtipicoSchema.safeParse({ activo: "si" }).success).toBe(false);
    expect(editarPeriodoAtipicoSchema.safeParse({ motivo: "" }).success).toBe(false);
  });
});

describe("temporadaAgrupacion", () => {
  it("solo los tres códigos", () => {
    for (const t of ["invierno", "verano", "todo_el_ano"]) expect(temporadaAgrupacion.safeParse(t).success).toBe(true);
    for (const t of ["otono", "Invierno", "todo el año", ""]) expect(temporadaAgrupacion.safeParse(t).success).toBe(false);
  });
});

describe("leerConsultaAnios (?agrupacion_id= | ?temporada= | ?desde= | ?hasta=)", () => {
  it("sin parámetros: temporada=invierno y sin años", () => {
    expect(leerConsultaAnios(params({}))).toEqual({ consulta: { agrupacion_id: null, con_volumen: false, temporada: "invierno" }, rechazo: null });
  });
  it("por temporada", () => {
    const r = leerConsultaAnios(params({ temporada: "verano", desde: "2023", hasta: "2026" }));
    expect(r.consulta).toEqual({ agrupacion_id: null, con_volumen: false, temporada: "verano", desde: 2023, hasta: 2026 });
  });
  it("por agrupación", () => {
    expect(leerConsultaAnios(params({ agrupacion_id: UUID })).consulta).toEqual({ agrupacion_id: UUID, con_volumen: false, temporada: "invierno" });
  });
  it("400 si vienen los dos criterios o la temporada no es válida", () => {
    expect(leerConsultaAnios(params({ agrupacion_id: UUID, temporada: "invierno" })).rechazo?.status).toBe(400);
    const r = leerConsultaAnios(params({ temporada: "otono" }));
    expect(r.rechazo).toEqual({ status: 400, mensaje: "La temporada debe ser invierno, verano o todo_el_ano." });
  });
  it("404 si agrupacion_id no es un UUID (igual que un id de ruta mal formado)", () => {
    expect(leerConsultaAnios(params({ agrupacion_id: "abc" })).rechazo).toEqual({
      status: 404,
      mensaje: "Agrupación de estacionalidad no encontrada.",
    });
  });
  it("400 si los años no son años de cuatro cifras, hasta < desde o piden demasiados", () => {
    const malos: Array<Record<string, string>> = [{ desde: "23" }, { hasta: "dos mil" }, { desde: "1999" }, { desde: "2026", hasta: "2023" }, { desde: "2000", hasta: "2100" }];
    for (const p of malos) {
      expect(leerConsultaAnios(params(p)).rechazo?.status, JSON.stringify(p)).toBe(400);
    }
    expect(leerConsultaAnios(params({ desde: "2026", hasta: "2026" })).consulta).toEqual({
      agrupacion_id: null,
      con_volumen: false,
      temporada: "invierno",
      desde: 2026,
      hasta: 2026,
    });
  });
  it("valores vacíos se tratan como ausentes", () => {
    expect(leerConsultaAnios(params({ temporada: "", desde: "", agrupacion_id: "" })).consulta).toEqual({
      agrupacion_id: null,
      con_volumen: false,
      temporada: "invierno",
    });
  });
});
