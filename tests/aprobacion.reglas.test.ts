import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  bloqueoDeReversion,
  bloqueosDeLote,
  desvioPct,
  motivoRechazoAnioYFuentes,
  motivoRechazoRevertir,
  revisionRequerida,
  type ArgsBloqueosLote,
} from "@/lib/aprobacion/reglas";
import { CALCULO_CADUCA_MIN, VERSION_METODO } from "@/lib/proyeccion/tipos-api";
import { motivoRechazoCerrar } from "@/lib/proyeccion/reglas";
import { REVISION_OBLIGATORIA_DESDE } from "@/lib/aprobacion/tipos-api";

/** Reglas de estado de la aprobación en bloque (07g): D14 y R13 (bloqueos), D12 (revertir), R7 (un año por lote) y §4.4 (revisión). */

const AHORA = "2026-11-03T10:00:00.000Z";
const limpio = (extra: Partial<ArgsBloqueosLote> = {}): ArgsBloqueosLote => ({
  estado: "en_trabajo",
  calculandoDesde: null,
  ahora: AHORA,
  anioEnCurso: 2026,
  versionMetodo: VERSION_METODO,
  desactualizada: [],
  ...extra,
});
const codigos = (a: ArgsBloqueosLote) => bloqueosDeLote(a).map((b) => b.codigo);
const desact = (...codigo: string[]) => codigo.map((c) => ({ codigo: c, mensaje: `Motivo ${c}.` }));
const sinAprobar = (extra: Partial<NonNullable<ArgsBloqueosLote["crecimientosSinAprobar"]>> = {}) => ({ anio: 2027, faltan: [], resto_provisional: false, ...extra });

describe("D14 y R13 · bloqueos de todo lote aprobar o reaprobar", () => {
  it("una proyección al día no bloquea", () => {
    expect(bloqueosDeLote(limpio())).toEqual([]);
  });

  it("cerrada, archivada o calculándose bloquean y no se sigue mirando", () => {
    expect(codigos(limpio({ estado: "cerrada", versionMetodo: 3, desactualizada: desact("cargas_nuevas") }))).toEqual(["cerrada"]);
    expect(codigos(limpio({ estado: "archivada" }))).toEqual(["archivada"]);
    const hace1min = new Date(Date.parse(AHORA) - 60_000).toISOString();
    expect(codigos(limpio({ calculandoDesde: hace1min }))).toEqual(["calculo_en_curso"]);
    // un cálculo caducado ya no bloquea
    const hace = new Date(Date.parse(AHORA) - (CALCULO_CADUCA_MIN + 1) * 60_000).toISOString();
    expect(codigos(limpio({ calculandoDesde: hace }))).toEqual([]);
  });

  it("version_metodo < 5 (o sin versión) bloquea", () => {
    expect(codigos(limpio({ versionMetodo: 3 }))).toEqual(["version_metodo"]);
    expect(codigos(limpio({ versionMetodo: null }))).toEqual(["version_metodo"]);
    expect(codigos(limpio({ versionMetodo: VERSION_METODO + 1 }))).toEqual([]);
  });

  it("desactualizada por CUALQUIER motivo bloquea, con los motivos en el detalle", () => {
    for (const motivo of ["cargas_nuevas", "curvas_cambiadas", "tiendas_cambiadas", "recalculo_pendiente", "crecimientos_cambiados", "config_cambiada", "temporada_cambiada"]) {
      const [b] = bloqueosDeLote(limpio({ desactualizada: desact(motivo) }));
      expect(b.codigo).toBe("proyeccion_desactualizada");
      expect(b.detalle).toEqual({ motivos: [{ codigo: motivo, mensaje: `Motivo ${motivo}.` }] });
      expect(b.mensaje).toMatch(/recalcula/i);
    }
    expect(bloqueosDeLote(limpio({ desactualizada: desact("a", "b") }))[0].detalle).toMatchObject({ motivos: [{ codigo: "a" }, { codigo: "b" }] });
  });

  it("los del Niño bloquean (todos, en el orden del cierre)", () => {
    expect(codigos(limpio({ bloqueosNino: { factorFaltante: [{ anio: 2026, temporada: "invierno" }] } }))).toEqual(["factor_faltante"]);
    expect(codigos(limpio({ bloqueosNino: { anioSiguienteAtipico: { meses: ["2027-06"] }, factorFaltante: [{ anio: 2026, temporada: "verano" }], temporadaCambiada: true } }))).toEqual([
      "anio_siguiente_atipico",
      "factor_faltante",
      "temporada_cambiada",
    ]);
    expect(codigos(limpio({ bloqueosNino: {} }))).toEqual([]);
  });

  it("crecimientos de 2027 sin aprobar bloquean: faltan, Resto provisional o reaprobar de 06e", () => {
    const faltan = bloqueosDeLote(limpio({ crecimientosSinAprobar: sinAprobar({ faltan: [{ clave: "g.m", nombre: "HOMBRE · URBANO" }] }) }));
    expect(faltan.map((b) => b.codigo)).toEqual(["crecimientos_sin_aprobar"]);
    expect(faltan[0].mensaje).toMatch(/HOMBRE · URBANO/);
    expect(faltan[0].detalle).toMatchObject({ crecimientos_sin_aprobar: { faltan: [{ clave: "g.m" }], resto_provisional: false } });
    expect(codigos(limpio({ crecimientosSinAprobar: sinAprobar({ resto_provisional: true }) }))).toEqual(["crecimientos_sin_aprobar"]);
    expect(codigos(limpio({ crecimientosSinAprobar: sinAprobar({ reaprobar: [{ clave: "g.m", nombre: "HOMBRE · URBANO", version: 1, correccion_pct: 4.3 }] }) }))).toEqual(["crecimientos_sin_aprobar"]);
    expect(codigos(limpio({ crecimientosSinAprobar: sinAprobar({ reaprobar: [] }) }))).toEqual([]);
    expect(codigos(limpio({ crecimientosSinAprobar: null }))).toEqual([]);
  });

  it("todo junto: el orden es el del cierre y la desactualizada va al final", () => {
    expect(
      codigos(
        limpio({
          versionMetodo: 4,
          desactualizada: desact("cargas_nuevas"),
          bloqueosNino: { factorFaltante: [{ anio: 2026, temporada: "invierno" }] },
          crecimientosSinAprobar: sinAprobar({ resto_provisional: true }),
        })
      )
    ).toEqual(["version_metodo", "factor_faltante", "crecimientos_sin_aprobar", "proyeccion_desactualizada"]);
  });

  it("el primero coincide con el rechazo de motivoRechazoCerrar con las mismas condiciones (misma regla que el cierre)", () => {
    const casos: Partial<ArgsBloqueosLote>[] = [
      { versionMetodo: 2 },
      { desactualizada: desact("tiendas_cambiadas") },
      { bloqueosNino: { factorDesfasado: [{ anio: 2026, temporada: "invierno", motivos: ["cargas"] }] } },
      { crecimientosSinAprobar: sinAprobar({ resto_provisional: true }) },
    ];
    for (const c of casos) {
      const a = limpio(c);
      const r = motivoRechazoCerrar({
        estado: a.estado,
        calculandoDesde: a.calculandoDesde,
        ahora: a.ahora,
        anioEnCurso: a.anioEnCurso,
        filasBase: [],
        tiendas: [],
        desactualizada: a.desactualizada.length > 0,
        forzar: false,
        metodoViejo: a.versionMetodo === null || a.versionMetodo < VERSION_METODO,
        bloqueosNino: a.bloqueosNino,
        crecimientosSinAprobar: a.crecimientosSinAprobar,
      });
      expect(r.ok).toBe(false);
      const primero = bloqueosDeLote(a)[0].codigo;
      expect(primero).toBe(!r.ok && r.rechazo.codigo === "desactualizada" ? "proyeccion_desactualizada" : !r.ok ? r.rechazo.codigo : "");
    }
  });
});

describe("D12 · revertir no se bloquea por desactualizada ni por crecimientos", () => {
  it("solo exige en trabajo y sin cálculo en curso", () => {
    expect(bloqueoDeReversion({ estado: "en_trabajo", calculandoDesde: null, ahora: AHORA })).toBeNull();
    expect(bloqueoDeReversion({ estado: "cerrada", calculandoDesde: null, ahora: AHORA })).toMatchObject({ status: 409, codigo: "cerrada" });
    expect(bloqueoDeReversion({ estado: "archivada", calculandoDesde: null, ahora: AHORA })).toMatchObject({ status: 409, codigo: "archivada" });
    expect(bloqueoDeReversion({ estado: "en_trabajo", calculandoDesde: new Date(Date.parse(AHORA) - 1000).toISOString(), ahora: AHORA })).toMatchObject({ codigo: "calculo_en_curso" });
  });

  it("se revierte un lote aprobar o reaprobar de esta proyección; una reversión no se revierte (R11)", () => {
    expect(motivoRechazoRevertir({ tipo: "aprobar", proyeccionIdDelLote: "p1", proyeccionId: "p1" })).toBeNull();
    expect(motivoRechazoRevertir({ tipo: "reaprobar", proyeccionIdDelLote: "p1", proyeccionId: "p1" })).toBeNull();
    expect(motivoRechazoRevertir({ tipo: "revertir", proyeccionIdDelLote: "p1", proyeccionId: "p1" })).toMatchObject({ status: 409, codigo: "no_revertible" });
    expect(motivoRechazoRevertir({ tipo: "aprobar", proyeccionIdDelLote: "p2", proyeccionId: "p1" })).toMatchObject({ codigo: "no_revertible" });
    expect(motivoRechazoRevertir({ tipo: "aprobar", proyeccionIdDelLote: null, proyeccionId: "p1" })).toMatchObject({ codigo: "no_revertible" });
  });
});

describe("R7 · un año por lote; la IA solo en Y+1", () => {
  it("solo Y o Y+1; ia en Y → anio_no_admitido", () => {
    expect(motivoRechazoAnioYFuentes({ anio: 2026, anioEnCurso: 2026, fuentes: ["metodo"] })).toBeNull();
    expect(motivoRechazoAnioYFuentes({ anio: 2027, anioEnCurso: 2026, fuentes: ["ia", "metodo"] })).toBeNull();
    expect(motivoRechazoAnioYFuentes({ anio: 2028, anioEnCurso: 2026, fuentes: ["metodo"] })).toMatchObject({ status: 409, codigo: "anio_no_admitido" });
    expect(motivoRechazoAnioYFuentes({ anio: 2025, anioEnCurso: 2026, fuentes: [] })).toMatchObject({ codigo: "anio_no_admitido" });
    const ia26 = motivoRechazoAnioYFuentes({ anio: 2026, anioEnCurso: 2026, fuentes: ["metodo", "ia"] });
    expect(ia26).toMatchObject({ status: 409, codigo: "anio_no_admitido" });
    expect(ia26?.mensaje).toMatch(/2027/);
  });
});

describe("§4.4 · cuándo la confirmación exige «Revisé el resumen por GM»", () => {
  const ef = (despues: number | null, meta: number | null) => ({ desvio_despues_u: despues, meta_despues: meta });

  it("desvioPct: desvío ÷ meta en %; nulo sin meta positiva o sin desvío", () => {
    expect(desvioPct(260, 26000)).toBeCloseTo(1, 6);
    expect(desvioPct(-130, 26000)).toBeCloseTo(-0.5, 6);
    expect(desvioPct(null, 100)).toBeNull();
    expect(desvioPct(5, null)).toBeNull();
    expect(desvioPct(5, 0)).toBeNull();
  });

  it("más de 100 filas pedidas la exigen; 100 no", () => {
    expect(revisionRequerida({ filasPedidas: REVISION_OBLIGATORIA_DESDE + 1, efecto: [] })).toBe(true);
    expect(revisionRequerida({ filasPedidas: REVISION_OBLIGATORIA_DESDE, efecto: [] })).toBe(false);
  });

  it("un GM a más de ±1 % de su meta la exige; justo 1 % o sin meta, no", () => {
    expect(revisionRequerida({ filasPedidas: 3, efecto: [ef(418, 26006)] })).toBe(true);
    expect(revisionRequerida({ filasPedidas: 3, efecto: [ef(-418, 26006)] })).toBe(true);
    expect(revisionRequerida({ filasPedidas: 3, efecto: [ef(260, 26000)] })).toBe(false);
    expect(revisionRequerida({ filasPedidas: 3, efecto: [ef(0, 26006), ef(60, 26006)] })).toBe(false);
    expect(revisionRequerida({ filasPedidas: 3, efecto: [ef(500, null), ef(null, 100)] })).toBe(false);
  });
});

describe("R13 estático · los bloqueos no dependen de src/lib/ia/ ni de node", () => {
  const RAIZ = path.resolve(__dirname, "..");
  const importsDe = (ruta: string): string[] => {
    const p = path.join(RAIZ, ruta);
    if (!existsSync(p)) return [];
    const texto = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    return [...texto.matchAll(/(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  };

  it("reglas.ts no importa la IA, node:* ni la base", () => {
    const imports = importsDe("src/lib/aprobacion/reglas.ts");
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((i) => /^@\/lib\/ia(\/|$)/.test(i) || i.startsWith("node:") || /supabase|server-only|consultas/.test(i))).toEqual([]);
  });

  it("servicio.ts, si existe, tampoco importa la IA para los bloqueos (solo `ia/servicio` para ítems o columnas de IA)", () => {
    const imports = importsDe("src/lib/aprobacion/servicio.ts").filter((i) => /^@\/lib\/ia(\/|$)/.test(i));
    expect(imports.filter((i) => i !== "@/lib/ia/servicio")).toEqual([]);
  });
});
