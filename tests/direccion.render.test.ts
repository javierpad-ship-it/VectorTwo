import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlertasTablero, BloqueosCierre, ListaAlertas } from "../src/app/(app)/planificacion/aprobacion-direccion/alertas-tablero";
import { Apoyo } from "../src/app/(app)/planificacion/aprobacion-direccion/apoyo";
import { AvisosCabecera, BarraDecidirMovil, BarraDecision, muestraDecidir } from "../src/app/(app)/planificacion/aprobacion-direccion/barra-decision";
import { CrecimientosGm } from "../src/app/(app)/planificacion/aprobacion-direccion/crecimientos-gm";
import { ContenidoDecision, DecisionModal } from "../src/app/(app)/planificacion/aprobacion-direccion/decision-modal";
import { DecisionesOrigen } from "../src/app/(app)/planificacion/aprobacion-direccion/decisiones-origen";
import { ControlesFiltros, FiltrosTablero } from "../src/app/(app)/planificacion/aprobacion-direccion/filtros-tablero";
import { FrenteAprobada } from "../src/app/(app)/planificacion/aprobacion-direccion/frente-aprobada";
import { GraficoTablero } from "../src/app/(app)/planificacion/aprobacion-direccion/grafico-tablero";
import { HistorialAprobaciones } from "../src/app/(app)/planificacion/aprobacion-direccion/historial-aprobaciones";
import { Kpis } from "../src/app/(app)/planificacion/aprobacion-direccion/kpis";
import { Mayores } from "../src/app/(app)/planificacion/aprobacion-direccion/mayores";
import { Puente } from "../src/app/(app)/planificacion/aprobacion-direccion/puente";
import { ResumenDecidir } from "../src/app/(app)/planificacion/aprobacion-direccion/resumen-decidir";
import { TablaDesglose } from "../src/app/(app)/planificacion/aprobacion-direccion/tabla-desglose";
import { TablaMensual } from "../src/app/(app)/planificacion/aprobacion-direccion/tabla-mensual";
import { accionDeError, ErrorTablero, TableroPanel } from "../src/app/(app)/planificacion/aprobacion-direccion/tablero-panel";
import { FILTROS_VACIOS, vistaBloqueos, type FiltrosVista, type FormularioDecision } from "../src/app/(app)/planificacion/aprobacion-direccion/vista-tablero";
import { AvisoDireccion, AvisoDireccionVista } from "../src/components/direccion/aviso-direccion";
import { NAV_SECTIONS, puedeVerRuta, seccionesVisibles } from "../src/lib/nav";
import {
  aprobacion,
  bloqueos,
  bloqueosNinguno,
  bloqueosSoloDesactualizada,
  estadoDireccion,
  historial,
  ID,
  opciones,
  proyeccionEnTrabajo,
  tablero,
  tableroArchivada,
  tableroConTienda,
  tableroEnTrabajo,
} from "./direccion.pantalla.fixture";

/**
 * Render de la pantalla del tablero de dirección (ficha 14, §4) sin red ni efectos: `useLectura` se sustituye por lecturas falsas por ruta y la URL de
 * la página por una de prueba. Un render de servidor no corre efectos, así que la pantalla sale como en un teléfono (antes de medir el ancho).
 */
type Lectura = { datos: unknown; cargando: boolean; error: string | null; codigo: string | null };
const lecturas: { porRuta: Map<string, Lectura>; pedidas: string[] } = { porRuta: new Map(), pedidas: [] };
const url = { query: "" };

vi.mock("../src/app/(app)/planificacion/proyeccion/use-proyeccion", async (original) => {
  const real = await original<typeof import("../src/app/(app)/planificacion/proyeccion/use-proyeccion")>();
  return {
    ...real,
    useLectura: (ruta: string | null) => {
      if (ruta !== null) lecturas.pedidas.push(ruta);
      const clave = ruta === null ? null : [...lecturas.porRuta.keys()].find((k) => ruta === k || ruta.startsWith(`${k}?`));
      const l: Lectura = (clave ? lecturas.porRuta.get(clave) : undefined) ?? { datos: null, cargando: ruta !== null, error: null, codigo: null };
      return { ...l, setError: () => {}, recargar: () => Promise.resolve() };
    },
  };
});
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(url.query),
  usePathname: () => "/planificacion/aprobacion-direccion",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  redirect: () => {},
}));

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};
const RAIZ = path.resolve(__dirname, "..");
const DIR = "src/app/(app)/planificacion/aprobacion-direccion";
const fuente = (ruta: string) => readFileSync(path.join(RAIZ, ruta), "utf8");
const listo = (datos: unknown): Lectura => ({ datos, cargando: false, error: null, codigo: null });
const fallo = (error: string, codigo: string | null): Lectura => ({ datos: null, cargando: false, error, codigo });
const boton = (s: string, texto: string) => new RegExp(`<button[^>]*>${texto}</button>`).exec(s)?.[0];
const deshabilitado = (tag: string | undefined) => /\sdisabled(=""|\s|>)/.test(tag ?? "");
const cuenta = (s: string, trozo: string) => s.split(trozo).length - 1;
const filtros = (extra: Partial<FiltrosVista> = {}): FiltrosVista => ({ ...FILTROS_VACIOS, ...extra });
const sinBloqueos = { estado: "no_aplica" } as const;
const conBloqueos = (b = bloqueos()) => vistaBloqueos({ enTrabajo: true, datos: b, cargando: false, error: null });

function servir(t = tablero(), extra: Record<string, Lectura> = {}) {
  lecturas.porRuta = new Map<string, Lectura>([
    ["/api/direccion/opciones", listo(opciones())],
    ["/api/direccion/tablero", listo(t)],
    ["/api/direccion/aprobaciones", listo({ huella_actual: t.huella, estado: t.decidir.estado, vigente: null, historial: historial() })],
    ["/api/direccion/bloqueos", listo(bloqueos())],
    ...Object.entries(extra),
  ]);
}

beforeEach(() => {
  lecturas.porRuta = new Map();
  lecturas.pedidas = [];
  url.query = "";
});

describe("dónde vive y quién la ve", () => {
  it("está en el menú de Planificación para admin y planner; el comprador no la ve ni entra por URL", () => {
    const l = NAV_SECTIONS.flatMap((s) => s.links).find((x) => x.href === "/planificacion/aprobacion-direccion");
    expect(l?.label).toBe("Aprobación de dirección");
    expect(l?.pendiente).toBeUndefined();
    expect(NAV_SECTIONS.find((s) => s.links.includes(l!))?.title).toBe("Planificación");
    for (const rol of ["admin", "planner"] as const) {
      expect(seccionesVisibles(rol).flatMap((s) => s.links).some((x) => x.href === "/planificacion/aprobacion-direccion")).toBe(true);
      expect(puedeVerRuta(rol, "/planificacion/aprobacion-direccion")).toBe(true);
    }
    expect(seccionesVisibles("comprador").flatMap((s) => s.links).some((x) => x.href === "/planificacion/aprobacion-direccion")).toBe(false);
    expect(puedeVerRuta("comprador", "/planificacion/aprobacion-direccion")).toBe(false);
  });

  it("la página es un server component mínimo: valida el rol, redirige y envuelve el panel en Suspense", () => {
    const c = fuente(`${DIR}/page.tsx`);
    expect(c).not.toContain('"use client"');
    expect(c).toContain("perfilActual()");
    expect(c).toContain("puedeEditarMaestros(r.rol)");
    expect(c).toContain('redirect("/")');
    expect(c).toMatch(/<Suspense[\s\S]*<TableroPanel esAdmin=\{r\.rol === "admin"\} \/>/);
    expect(c).toContain("export const metadata");
  });

  it("los datos van solo por /api: nada de Supabase ni fetch directo, y los colores son tokens del tema", () => {
    const archivos = [...readdirSync(path.join(RAIZ, DIR)).map((f) => `${DIR}/${f}`), "src/components/direccion/aviso-direccion.tsx", "src/components/direccion/vista-aviso.ts", "src/components/direccion/formato.ts", "src/lib/direccion/excel.ts"];
    expect(archivos.length).toBeGreaterThanOrEqual(20);
    for (const f of archivos) {
      const c = fuente(f);
      expect(c, f).not.toMatch(/@supabase|supabase\/(browser|admin|server)/);
      expect(c, f).not.toMatch(/\bfetch\(/);
      expect(c, f).not.toMatch(/\b(bg|text|border)-(red|green|blue|gray|slate|amber|yellow|white|black)-\d/);
      expect(c, f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });

  it("la hoja de Excel de `src/lib/direccion` es de solo lectura (no escribe ni llama funciones de la base)", () => {
    const c = fuente("src/lib/direccion/excel.ts");
    expect(c).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(c).not.toMatch(/revision_cola_larga|umbral_cola_larga|venta_proyeccion|\bia_/);
  });
});

describe("el tablero completo, por rol", () => {
  it("admin: se lee lo de decidir arriba, en el orden de la ficha, y «Decidir» está en la cabecera y en la barra fija del móvil", () => {
    servir();
    const s = html(createElement(TableroPanel, { esAdmin: true }));
    const orden = [
      "Aprobación de dirección",
      "Proyección 2026–2027 · cerrada el 07 nov 2026 por Planner P. · datos hasta set 2026 · la que usa Compras",
      "Para decidir",
      "Resumen para decidir",
      "De 2026 a 2027: de dónde sale el aumento",
      "Alertas para aprobar",
      "Frente a lo aprobado",
      "Explorar",
      "2027 proyectado",
      "Mes a mes",
      "Desglose",
      "Crecimiento declarado, implícito y tendencia",
      "Cómo se decidió",
      "Datos de apoyo: soles y cobertura",
      "filas mayores",
      "Historial de aprobaciones",
    ];
    let desde = -1;
    for (const titulo of orden) {
      const i = s.indexOf(titulo, desde + 1);
      expect(i, titulo).toBeGreaterThan(desde);
      desde = i;
    }
    expect(cuenta(s, ">Decidir</button>")).toBe(2);
    expect(s).toContain("fixed inset-x-0 bottom-0");
    expect(s).toContain("pb-20 md:pb-0");
    expect(s).toContain("Descargar Excel");
    expect(s).toContain("Sin aprobación de dirección");
  });

  it("planner: ve todo igual, con el estado en texto y el historial, y sin ningún botón «Decidir»", () => {
    servir();
    const s = html(createElement(TableroPanel, { esAdmin: false }));
    expect(s).not.toContain(">Decidir</button>");
    expect(s).not.toContain("fixed inset-x-0 bottom-0");
    for (const t of ["Resumen para decidir", "Alertas para aprobar", "Explorar", "Historial de aprobaciones", "Sin aprobación de dirección", "Descargar Excel"]) expect(s).toContain(t);
  });

  it("pide el tablero con los nombres de la API, y lo que bloquearía el cierre solo si está en trabajo", () => {
    url.query = `proyeccion=${ID.proyeccion}&generos=${ID.hombre}&mundo=${ID.urbano}&linea=${ID.l1}&comparar=ninguna`;
    servir();
    html(createElement(TableroPanel, { esAdmin: true }));
    const pedido = lecturas.pedidas.find((p) => p.startsWith("/api/direccion/tablero"))!;
    expect(pedido).toContain(`proyeccion_id=${ID.proyeccion}`);
    expect(pedido).toContain("comparar_id=ninguna");
    expect(pedido).toContain(`mundo_id=${ID.urbano}`);
    expect(pedido).toContain(`linea_id=${ID.l1}`);
    expect(pedido).not.toMatch(/[?&](proyeccion|comparar|mundo|linea)=/);
    expect(lecturas.pedidas).toContain("/api/direccion/opciones");
    expect(lecturas.pedidas).toContain(`/api/direccion/aprobaciones?proyeccion_id=${ID.proyeccion}`);
    expect(lecturas.pedidas.some((p) => p.startsWith("/api/direccion/bloqueos"))).toBe(false);

    lecturas.pedidas = [];
    servir(tableroEnTrabajo());
    const s = html(createElement(TableroPanel, { esAdmin: true }));
    expect(lecturas.pedidas).toContain(`/api/direccion/bloqueos?proyeccion_id=${ID.enTrabajo}`);
    expect(s).toContain("En trabajo; 2 causas bloquearían el cierre");
    expect(s).toContain("En trabajo: las cifras pueden cambiar");
  });

  it("el resto del tablero no espera a /bloqueos: mientras llega, dice «comprobando»", () => {
    servir(tableroEnTrabajo(), { "/api/direccion/bloqueos": { datos: null, cargando: true, error: null, codigo: null } });
    const s = html(createElement(TableroPanel, { esAdmin: true }));
    expect(s).toContain("En trabajo; comprobando qué bloquearía el cierre…");
    expect(s).toContain("Comprobando qué bloquearía el cierre…");
    expect(s).toContain("2027: 84,714 u, +7.9 % sobre el cierre 2026");
    expect(s).toContain("52,708 u");
  });

  it("archivada: se ve en solo lectura y sin «Decidir», también para el admin", () => {
    servir(tableroArchivada());
    const s = html(createElement(TableroPanel, { esAdmin: true }));
    expect(s).toContain("Archivada: solo lectura");
    expect(s).not.toContain(">Decidir</button>");
    expect(muestraDecidir(true, tableroArchivada())).toBe(false);
    expect(muestraDecidir(false, tablero())).toBe(false);
    expect(muestraDecidir(true, null)).toBe(false);
  });

  it("mientras carga dice que carga; un filtro sin datos ofrece limpiar y conserva lo de decidir", () => {
    lecturas.porRuta = new Map([["/api/direccion/opciones", listo(opciones())]]);
    expect(html(createElement(TableroPanel, { esAdmin: true }))).toContain("Cargando el tablero…");
    const t = tablero();
    servir({ ...t, kpis: { ...t.kpis, siguiente: 0, cierre: 0, real_ac: 0, proyectado_resto: 0, anterior: 0, hace_dos: 0, hace_tres: 0 } });
    url.query = `am=${ID.amB}`;
    const s = html(createElement(TableroPanel, { esAdmin: true }));
    expect(s).toContain("Sin venta ni proyección con estos filtros");
    expect(s).toContain("Limpiar filtros");
    expect(s).toContain("Resumen para decidir");
    expect(s).toContain("Crecimiento declarado, implícito y tendencia");
    expect(s).not.toContain("Mes a mes");
  });
});

describe("estados vacíos y de error", () => {
  const render = (mensaje: string, codigo: string | null, hayFiltros = false) => html(createElement(ErrorTablero, { mensaje, codigo, hayFiltros, onReintentar: noop, onPorDefecto: noop, onLimpiar: noop }));

  it("cada código ofrece su acción y el mensaje del servidor se muestra siempre", () => {
    expect(accionDeError("sin_proyeccion")).toBe("ir_a_proyeccion");
    expect(accionDeError("calculo_en_curso")).toBe("reintentar");
    expect(accionDeError("proyeccion_no_encontrada")).toBe("abrir_por_defecto");
    expect(accionDeError("marca_fuera_de_agrupacion")).toBe("limpiar_filtros");
    expect(accionDeError(null)).toBe("reintentar");

    const sin = render("No hay ninguna proyección para abrir.", "sin_proyeccion");
    expect(sin).toContain("No hay proyección calculada");
    expect(sin).toContain('href="/planificacion/proyeccion"');
    const calcular = render("Calcula la proyección para verla en el tablero", "sin_calcular");
    expect(calcular).toContain("Calcula la proyección para verla en el tablero");
    expect(calcular).toContain("Ir a Proyección");
    const curso = render("La proyección se está calculando.", "calculo_en_curso");
    expect(curso).toContain("Se está recalculando; vuelve en unos minutos. La proyección se está calculando.");
    expect(curso).toContain("Reintentar");
    const error = render("No se pudo leer el tablero.", null, true);
    expect(error).toContain('role="alert"');
    expect(error).toContain("No se pudo leer el tablero.");
    expect(error).toContain("Reintentar");
    expect(error).toContain("Limpiar filtros");
    expect(render("La proyección no existe.", "proyeccion_no_encontrada")).toContain("Abrir la proyección por defecto");
    expect(render("La marca no es de esas agrupaciones.", "marca_fuera_de_agrupacion")).toContain("Limpiar filtros");
  });

  it("con error, el panel no deja a la vista el tablero de otra consulta", () => {
    lecturas.porRuta = new Map<string, Lectura>([
      ["/api/direccion/opciones", listo(opciones())],
      ["/api/direccion/tablero", { datos: tablero(), cargando: false, error: "La proyección se está calculando.", codigo: "calculo_en_curso" }],
    ]);
    const s = html(createElement(TableroPanel, { esAdmin: true }));
    expect(s).toContain("Se está recalculando; vuelve en unos minutos.");
    expect(s).not.toContain("Resumen para decidir");
    expect(s).not.toContain(">Decidir</button>");
    // El selector de proyección sigue disponible para abrir otra.
    expect(s).toContain("Proyección 2026–2027 seguimiento oct · en trabajo");
  });

  it("sin ninguna proyección: estado vacío con enlace a Proyección", () => {
    lecturas.porRuta = new Map<string, Lectura>([
      ["/api/direccion/opciones", listo(opciones({ proyecciones: [], por_defecto: null, comparar_por_defecto: null }))],
      ["/api/direccion/tablero", fallo("No hay ninguna proyección para abrir.", "sin_proyeccion")],
    ]);
    const s = html(createElement(TableroPanel, { esAdmin: true }));
    expect(s).toContain("No hay proyección calculada");
    expect(s).toContain("Ir a Proyección");
  });
});

describe("cabecera: proyección, estado en texto, comparar con y decidir", () => {
  const props = { opciones: opciones(), tablero: tablero(), filtros: FILTROS_VACIOS, esAdmin: true, cargando: false, exportando: false, onProyeccion: noop, onComparar: noop, onDecidir: noop, onExcel: noop };

  it("dice qué proyección es y su estado de dirección en texto; compara por defecto con la última aprobada", () => {
    const s = html(createElement(BarraDecision, props));
    expect(s).toContain("Proyección 2026–2027 · cerrada el 07 nov 2026 por Planner P. · datos hasta set 2026 · la que usa Compras");
    expect(s).toContain("Sin aprobación de dirección");
    expect(s).toContain("La última aprobada: Proyección 2026–2027 seguimiento set");
    expect(s).toContain(">Sin comparar</option>");
    expect(s).toContain("Comparando con «Proyección 2026–2027 seguimiento set» (la última aprobada) · datos hasta set 2026");
    expect(s).toContain("md:sticky md:top-0");
    expect(deshabilitado(boton(s, "Decidir"))).toBe(false);
  });

  it("cada estado de dirección se lee en texto", () => {
    const con = (decidir: Partial<ReturnType<typeof tablero>["decidir"]>) => html(createElement(BarraDecision, { ...props, tablero: { ...tablero(), decidir: { ...tablero().decidir, ...decidir } } }));
    const a = aprobacion();
    expect(con({ estado: "aprobada", vigente: a, ultima: a })).toContain("Aprobada por Admin A. el 08 nov 2026");
    expect(con({ estado: "con_observaciones", vigente: { ...a, resultado: "con_observaciones" }, ultima: a })).toContain("Aprobada con observaciones por Admin A. el 08 nov 2026");
    expect(con({ estado: "rechazada", ultima: { ...a, resultado: "rechazada" } })).toContain("Rechazada por Admin A. el 08 nov 2026");
    expect(con({ estado: "invalidada", ultima: { ...a, invalidada: true, invalidada_por: "cifras" } })).toContain("Aprobación invalidada: la proyección cambió después del 08 nov 2026");
  });

  it("«Decidir» solo para el admin, deshabilitado mientras se relee o si no se puede aprobar", () => {
    expect(html(createElement(BarraDecision, { ...props, esAdmin: false }))).not.toContain(">Decidir</button>");
    expect(deshabilitado(boton(html(createElement(BarraDecision, { ...props, cargando: true })), "Decidir"))).toBe(true);
    const sinPoder = { ...tablero(), decidir: { ...tablero().decidir, puede_aprobar: false } };
    expect(deshabilitado(boton(html(createElement(BarraDecision, { ...props, tablero: sinPoder })), "Decidir"))).toBe(true);
    const movil = html(createElement(BarraDecidirMovil, { tablero: tablero(), cargando: false, onDecidir: noop }));
    expect(movil).toContain("md:hidden");
    expect(movil).toContain("h-11!");
    expect(movil).toContain("Sin aprobación de dirección");
  });

  it("avisos de la cabecera: en trabajo (con enlace a la que usa Compras), archivada y venta más nueva", () => {
    const enTrabajo = html(createElement(AvisosCabecera, { tablero: tableroEnTrabajo(), opciones: opciones() }));
    expect(enTrabajo).toContain("En trabajo: las cifras pueden cambiar");
    expect(enTrabajo).toContain(`href="/planificacion/aprobacion-direccion?proyeccion=${ID.proyeccion}"`);
    expect(enTrabajo).toContain("Hay venta publicada hasta oct 2026; esta proyección se calculó con datos hasta set 2026.");
    expect(html(createElement(AvisosCabecera, { tablero: tableroArchivada(), opciones: opciones() }))).toContain("Archivada: solo lectura");
    const t = tablero();
    expect(html(createElement(AvisosCabecera, { tablero: { ...t, datos: { ...t.datos, k_prima: 9, ultimo_publicado: "2026-09" } }, opciones: opciones() }))).toBe("");
  });
});

describe("para decidir: resumen, puente, alertas y frente a lo aprobado", () => {
  it("el resumen muestra las líneas del servidor, la precisión del método y el objetivo con el implícito", () => {
    const s = html(createElement(ResumenDecidir, { tablero: tablero(), bloqueos: sinBloqueos }));
    expect(cuenta(s, "<li")).toBe(5);
    expect(s).toContain("2027: 84,714 u, +7.9 % sobre el cierre 2026 y +13.7 % sobre 2025, el último año normal (2026 fue año del Niño).");
    expect(s).toContain("Precisión del método: con el año anterior se habría desviado -3.2 % (dentro de muestra).");
    expect(s).toContain("Objetivo global declarado: +6.0 %");
    expect(s).toContain("implícito en mismas tiendas: +7.9 % sobre 2026 corregido (+9.0 % sobre real)");
    const t = tablero();
    const sinDato = html(createElement(ResumenDecidir, { tablero: { ...t, decidir: { ...t.decidir, precision: { desvio_prueba_anterior_pct: null, rotulo: "dentro de muestra" }, objetivo_pct: null } }, bloqueos: sinBloqueos }));
    expect(sinDato).not.toContain("Precisión del método");
    expect(sinDato).not.toContain("Objetivo global");
  });

  it("en trabajo, la línea del cierre la completa la pantalla con /bloqueos", () => {
    const con = (b: ReturnType<typeof conBloqueos>) => html(createElement(ResumenDecidir, { tablero: tableroEnTrabajo(), bloqueos: b }));
    expect(con(conBloqueos())).toContain("En trabajo; 2 causas bloquearían el cierre");
    expect(con(conBloqueos(bloqueosSoloDesactualizada()))).toContain("En trabajo; está desactualizada, pero se puede cerrar igual");
    expect(con(conBloqueos(bloqueosNinguno()))).toContain("En trabajo; nada bloquea el cierre");
    expect(cuenta(con(conBloqueos()), "<li")).toBe(6);
  });

  it("el puente: total con sus pasos, ayuda en cada línea y la tabla por género × mundo", () => {
    const s = html(createElement(Puente, { tablero: tablero() }));
    expect(s).toContain("De 2026 a 2027: de dónde sale el aumento");
    for (const t of ["78,501", "-2,961", "75,540", "+753", "+4,670", "+1,343", "82,306", "+1,408", "+1,000", "84,714", "+7.9 % vs cierre"]) expect(s).toContain(t);
    expect(s).toContain("+ Cifras fijadas (a mano o sugeridas por IA)");
    expect(s).toContain("+ Otras diferencias con la propuesta");
    expect(s).toContain('title="Filas aceptadas en bloque, por IA o tal cual cuya propuesta cambió después al recalcular, y filas escaladas por tienda."');
    expect(s).toContain('title="Lo que el planner o el admin fijaron por encima o por debajo de la propuesta, a mano o aceptando una cifra sugerida por la IA."');
    expect(s).toContain("sr-only");
    expect(s).toContain("Por género × mundo");
    for (const t of ["HOMBRE · URBANO", "MUJER · URBANO", "Resto", "Total", "+ fijadas", "Mismas 2027", "52,708", "32,006"]) expect(s).toContain(t);
    expect(cuenta(s, ">Niño</span>")).toBe(2);
    expect(cuenta(s, "overflow-x-auto")).toBe(2);
    expect(s).not.toContain(">diferencia<");
  });

  it("alertas: nivel con icono y palabra, importantes a la vista e informativas plegadas, con enlace a donde se resuelven", () => {
    const s = html(createElement(AlertasTablero, { alertas: tablero().alertas, bloqueos: sinBloqueos }));
    expect(cuenta(s, "Importante</span>")).toBe(5);
    expect(s).toContain("<details");
    expect(s).toContain("Ver 5 informativas");
    expect(cuenta(s, "Informativo</span>")).toBe(5);
    expect(s).toContain("HOMBRE · URBANO declara +5.0 % y sus mismas tiendas van -3.9 % en ene–oct, corregido del Niño (-5.9 % en bruto).");
    expect(s).toContain(`href="/planificacion/proyeccion?proyeccion=${ID.proyeccion}&amp;pestana=crecimientos"`);
    expect(s).toContain('aria-hidden="true"');
    // Las del recorte no van aquí.
    expect(s).not.toContain("T12 sin venta propia (en este recorte)");
    expect(html(createElement(ListaAlertas, { alertas: [], alcance: "proyeccion", vacio: "Sin alertas importantes." }))).toContain("Sin alertas importantes.");
  });

  it("lo que bloquearía el cierre: causas con su mensaje, la forzable como «Se puede cerrar igual» y el conteo de filas", () => {
    const s = html(createElement(BloqueosCierre, { bloqueos: conBloqueos() }));
    expect(s).toContain("2 causas bloquearían el cierre");
    expect(cuenta(s, "Bloquea el cierre</span>")).toBe(2);
    expect(cuenta(s, "Se puede cerrar igual</span>")).toBe(1);
    expect(s).toContain("Los crecimientos aprobados cambiaron después de calcular: recalcúlala antes de cerrar.");
    expect(s).toContain("2027: 37 filas sin decidir, 41,200 u; 12 de ellas de cola larga para revisión");
    expect(s).toContain("Se publicó 2026-10 en M5.");
    expect(html(createElement(BloqueosCierre, { bloqueos: conBloqueos(bloqueosSoloDesactualizada()) }))).toContain("Nada bloquea el cierre; está desactualizada");
    expect(html(createElement(BloqueosCierre, { bloqueos: conBloqueos(bloqueosNinguno()) }))).toContain("Nada bloquea el cierre");
    expect(html(createElement(BloqueosCierre, { bloqueos: { estado: "cargando" } }))).toContain("Comprobando qué bloquearía el cierre…");
    expect(html(createElement(BloqueosCierre, { bloqueos: { estado: "error", mensaje: "Falló la lectura" }, onReintentar: noop }))).toContain("No se pudo comprobar qué bloquearía el cierre: Falló la lectura");
    expect(html(createElement(BloqueosCierre, { bloqueos: sinBloqueos }))).toBe("");
  });

  it("frente a lo aprobado: tabla por GM, o el texto de cada caso", () => {
    const s = html(createElement(FrenteAprobada, { tablero: tablero() }));
    expect(s).toContain("Aprobada el 03 nov 2026 por Admin A. en Proyección 2026–2027 seguimiento set.");
    for (const t of ["2027 aprobado", "2027 actual", "+1,006", "+208", "+1,214", "+1.5 %", "2026 cierre", "+201"]) expect(s).toContain(t);
    const t = tablero();
    const con = (d: ReturnType<typeof tablero>["decidir"]["diferencia"]) => html(createElement(FrenteAprobada, { tablero: { ...t, decidir: { ...t.decidir, diferencia: d } } }));
    expect(con(null)).toContain("Todavía no hay ninguna proyección aprobada.");
    expect(con({ ...t.decidir.diferencia!, identica: true })).toContain("Idéntica a lo aprobado el 03 nov 2026 en Proyección 2026–2027 seguimiento set; esta copia aún no tiene aprobación propia.");
    expect(con({ ...t.decidir.diferencia!, identica: true, misma_proyeccion: true })).toBe("");
  });
});

describe("explorar: filtros, tarjetas, gráfico y tablas", () => {
  it("los filtros: géneros con el atajo «Resto», mundo, línea, temporada, agrupación de marca, marca por agrupación, tiendas por situación y bloque", () => {
    const s = html(createElement(ControlesFiltros, { filtros: filtros({ generos: [ID.hombre], mundo: ID.urbano, am: [ID.amA], tiendas: [ID.t03] }), opciones: opciones(), tablero: tablero(), onCambiar: noop }));
    for (const t of ["HOMBRE", "MUJER", "NIÑOS", "BEBÉS", ">Resto</button>", "URBANO", "L1 POLOS", "L2 CASACAS", "Invierno", "Verano", "Todo el año", "Sin temporada", "AM-A", "AM-B", "MARCA X", "Buscar marca"]) expect(s).toContain(t);
    // Con AM-A elegida, solo se ofrecen sus unidades de marca; la línea solo lista las del género y el mundo elegidos.
    expect(s).toContain('<optgroup label="AM-A">');
    expect(s).not.toContain("MARCA Z");
    expect(s).not.toContain("L3 BLUSAS");
    for (const t of ["Mismas tiendas 2027", "Aperturas 2027", "Cierres 2027", "Cerradas o fuera de la proyección", "T03 · Tienda T03", "Tiendas (1)"]) expect(s).toContain(t);
    for (const t of ["Todas", "Mismas tiendas de 2027", "Tiendas nuevas", "Cierres 2027"]) expect(s).toContain(t);
    expect(s).toContain("Lo proyectado por marca es estimado con su participación de los últimos 12 meses en cada fila.");
  });

  it("sin un solo género y un mundo, la línea queda deshabilitada; con «Resto», sus géneros van marcados y bloqueados", () => {
    const s = html(createElement(ControlesFiltros, { filtros: filtros({ resto: true }), opciones: opciones(), tablero: null, onCambiar: noop }));
    expect(s).toContain("Elige un solo género y un mundo");
    expect(s).toMatch(/<button[^>]*aria-checked="true"[^>]*disabled=""[^>]*title="Incluido en «Resto»"/);
    expect(s).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Resto<\/button>/);
    expect(s).toContain(">Tiendas</p>");
  });

  it("en el móvil los filtros se abren desde un botón con su conteo; en pantallas anchas van a la vista", () => {
    const s = html(createElement(FiltrosTablero, { filtros: filtros({ generos: [ID.hombre], mundo: ID.urbano, tiendas: [ID.t03] }), opciones: opciones(), tablero: tablero(), onCambiar: noop, onLimpiar: noop }));
    expect(s).toMatch(/<div class="flex flex-wrap items-center gap-2 md:hidden"><button[^>]*>Filtros \(3\)<\/button>/);
    expect(s).toContain("hidden md:block");
    expect(s).toContain("Limpiar filtros");
    expect(html(createElement(FiltrosTablero, { filtros: FILTROS_VACIOS, opciones: opciones(), tablero: tablero(), onCambiar: noop, onLimpiar: noop }))).not.toContain("Limpiar filtros");
  });

  it("las cuatro tarjetas (dos por fila en el móvil), el puente del recorte en una línea y las alertas del recorte", () => {
    const s = html(createElement(Kpis, { tablero: tablero() }));
    expect(s).toContain("grid grid-cols-2 gap-3 lg:grid-cols-4");
    for (const t of ["2027 proyectado", "52,708 u", "+5.4 % vs cierre 2026", "+12.1 % vs 2025, último año normal", "2026 cierre", "50,001 u", "= real ene–set 34,000 + proyectado oct–dic 16,001", "año del Niño", "2026 en lo que va (ene–oct)", "38,300 u", "Mismas tiendas", "+6.9 % sobre real, +5.2 % sobre corregido (4 tiendas)"]) expect(s).toContain(t);
    expect(s).toContain("Base 47,040 → Niño +753 → crecimiento +2,390 → fijadas +117 → mismas 50,300 → aperturas +1,408 → cierres +1,000 → 52,708");
    expect(s).toContain("T12 sin venta propia (en este recorte)");
    expect(s).not.toContain(">estimado<");
  });

  it("con una tienda elegida: todo rotulado «estimado», la participación usada a la vista y sin puente del recorte", () => {
    const s = html(createElement(Kpis, { tablero: tableroConTienda() }));
    expect(cuenta(s, ">estimado</span>")).toBeGreaterThanOrEqual(4);
    expect(s).toContain("Mismas tiendas de 2027 (1): T03");
    expect(s).toContain("T03: 2027 estimado con su parte de la base 2026 (15.7 %)");
    expect(s).toContain("de 11.5 % en enero a 22.8 % en junio");
    expect(s).toContain("Sin atribuir en 2027: -12 u");
    expect(s).not.toContain("Puente del recorte");
  });

  it("el gráfico: figura descrita por la tabla mensual, leyenda con los años del Niño, línea de datos y lectura anunciada", () => {
    const s = html(createElement(GraficoTablero, { tablero: tablero() }));
    expect(s).toContain('<figure class="space-y-3" aria-describedby="tabla-mensual">');
    expect(s).toContain("<figcaption");
    expect(s).toContain("2027 proyecta 52,708 u, +5.4 % sobre el cierre 2026; el mes mayor es diciembre.");
    expect(s).toContain('aria-live="polite"');
    expect(s).toContain("Mensual");
    expect(s).toContain("Acumulado");
    expect(s).toContain("línea vertical: datos hasta set 2026");
    for (const t of ["2023 (Niño)", "2024", "2025", "2026 real (Niño)", "2026 proyectado (Niño)", "2026 sin Niño (derivado)", "2027 proyectado", "Proyección 2026–2027 seguimiento set (aprobada)"]) expect(s).toContain(t);
    expect(s).toContain("2026 dividido por el factor del Niño de cada mes, para ver qué parte del salto de 2027 es corrección.");
    // En el teléfono (render sin medir el ancho) 2023 y 2024 arrancan apagadas y las otras seis, encendidas.
    expect(cuenta(s, 'role="checkbox" aria-checked="false"')).toBe(2);
    expect(cuenta(s, 'role="checkbox" aria-checked="true"')).toBe(6);
    // Trazos distintos: discontinuo, guion y punto, punteado fino y punteado de la comparada.
    for (const d of ['stroke-dasharray="7 5"', 'stroke-dasharray="9 3 2 3"', 'stroke-dasharray="3 4"', 'stroke-dasharray="1 5"']) expect(s).toContain(d);
    // Ocupa el ancho disponible: sin ancho mínimo que obligue a desplazar la página.
    expect(s).toContain('viewBox="0 0 380 260" width="100%"');
    expect(s).not.toContain("min-width");
    expect(s).toContain("grid grid-cols-2");
    expect(s).toContain("tabindex=\"0\"");
  });

  it("con cifras atribuidas, la leyenda dice «(estimado)» y hay una nota", () => {
    const s = html(createElement(GraficoTablero, { tablero: tableroConTienda() }));
    expect(s).toContain("2027 proyectado (estimado)");
    expect(s).toContain("Las series marcadas «(estimado)» salen de la atribución por tienda o de la participación por marca");
  });

  it("la tabla mensual: primera columna fija, lo proyectado en cursiva y con «proy.», y meses sin carga con «—»", () => {
    const s = html(createElement(TablaMensual, { tablero: tablero() }));
    expect(s).toContain('id="tabla-mensual"');
    expect(s).toContain("overflow-x-auto");
    expect(s).toContain("sticky left-0");
    for (const t of ["2023 (Niño)", "2026 real (Niño)", "2026 proyectado (Niño)", "2026 cierre (Niño)", "2026 sin Niño", "2027 vs 2026 cierre (%)", "ene–oct", "Total"]) expect(s).toContain(t);
    expect(s).toContain('<span class="relative italic" title="proy."><span class="sr-only">proy. </span>8,044</span>');
    expect(s).toContain('title="sin carga publicada"');
    expect(s).toContain("52,708");
    expect(s).toContain("+5.4 %");
    const t03 = html(createElement(TablaMensual, { tablero: tableroConTienda() }));
    expect(t03).toContain(">estimado</span>");
    expect(t03).toContain("-12");
  });

  it("el desglose: selector de dimensión, filas elegibles como filtro, total al pie y desplazamiento dentro de la tabla", () => {
    const s = html(createElement(TablaDesglose, { tablero: tablero(), opciones: opciones(), actualizando: false, onDimension: noop, onFiltrar: noop }));
    for (const d of ["Género", "Mundo", "Línea", "Temporada", "Agrupación de marca", "Marca", "Tienda"]) expect(s).toContain(`>${d}</option>`);
    expect(s).toContain('<option value="linea" selected="">Línea</option>');
    expect(s.indexOf("L1 POLOS")).toBeLessThan(s.indexOf("L2 CASACAS"));
    expect(s).toMatch(/<button[^>]*title="Filtrar por L1 POLOS: su serie mensual se ve en el gráfico"[^>]*>L1 POLOS<\/button>/);
    expect(s).toContain("Total del recorte");
    for (const t of ["2023 (Niño)", "2025 ene–oct", "2026 ene–oct", "2026 cierre (Niño)", "% 27/26", "% 27/25", "% 26/25", "part. 2027", "39,408", "13,300", "52,708", "74.8 %"]) expect(s).toContain(t);
    expect(s).toContain("2 elementos");
    expect(s).toContain("overflow-x-auto");
  });

  it("crecimientos: declarado, implícito, las dos tendencias, la lectura en texto y las anomalías; el Resto sin crecimiento dice «sin dato»", () => {
    const s = html(createElement(CrecimientosGm, { tablero: tablero() }));
    expect(s).toContain("De la proyección entera (no cambia con los filtros). Tendencia: ene–oct de 2026 frente a ene–oct de 2025 en las mismas tiendas de 2026.");
    for (const t of ["+5.0 % sobre 2026 corregido", "v2 · Planner P. · 06 nov 2026", "+5.2 % sobre corregido (+6.9 % sobre real)", "-3.9 % corregida del Niño (-5.9 % en bruto)", "contra la tendencia: declara +5.0 %, la venta va -3.9 % corregida del Niño", "revisar: +4.3 pp", "+6.2 %", "reemplazada el mismo día", "sin nota", "Nota: Ajuste por campaña", "47,040", "47,793", "50,300"]) expect(s).toContain(t);
    const resto = s.slice(s.indexOf(">Resto<"), s.indexOf(">Total<"));
    expect(cuenta(resto, "sin dato")).toBe(4);
    expect(s).toContain("+7.9 % sobre corregido (+9.0 % sobre real)");
  });

  it("cómo se decidió, datos de apoyo (cada cifra estimada con su «estimado») y filas mayores", () => {
    const d = html(createElement(DecisionesOrigen, { tablero: tablero() }));
    for (const t of ["2027 · 52,708 u", "En bloque", "Aceptada tal cual", "A mano", "56 %", "Planner P.", "5 filas, 51,300 u, el 07 nov 2026", "El día con más decisiones: 07 nov 2026 (5 filas)."]) expect(d).toContain(t);
    const a = html(createElement(Apoyo, { tablero: tablero() }));
    expect(a).toContain("Datos de apoyo: estimados, no forman parte de lo que se aprueba");
    for (const t of ["S/ 2,350,000", "S/ 2,600,052", "S/ 2,740,816", "18,000 u", "12,000 u", "6.9 meses", "7.4 meses", "El índice de cobertura con el que se compra es el de Flujo mensual"]) expect(a).toContain(t);
    expect(cuenta(a, ">estimado</span>")).toBe(2);
    const t03 = html(createElement(Apoyo, { tablero: tableroConTienda() }));
    expect(cuenta(t03, ">estimado</span>")).toBe(3);
    expect(t03).toContain("no aplica con tiendas elegidas");
    expect(t03).toContain("3.8 meses");
    const m = html(createElement(Mayores, { tablero: tablero() }));
    for (const t of ["Las 10 filas mayores", "HOMBRE · URBANO · L1 POLOS · AM-A", "49.7 %", "+6.4 %", "sin base"]) expect(m).toContain(t);
  });
});

describe("decisión de dirección e historial", () => {
  const f = (extra: Partial<FormularioDecision> = {}): FormularioDecision => ({ resultado: null, motivo: "", comentario: "", confirmo: false, ...extra });
  const contenido = (extra: Partial<Parameters<typeof ContenidoDecision>[0]> = {}) => html(createElement(ContenidoDecision, { tablero: tablero(), bloqueos: sinBloqueos, formulario: f(), onFormulario: noop, error: null, ocupado: false, onRecargar: noop, ...extra }));

  it("dice que se decide sobre la proyección entera, repite el resumen y las alertas importantes, y ofrece las tres opciones", () => {
    const s = contenido();
    expect(s).toContain("Vas a decidir sobre");
    expect(s).toContain("Proyección 2026–2027 (cerrada)");
    expect(s).toContain("completa, no sobre el recorte que estás mirando.");
    expect(s).toContain("2027: 84,714 u, +7.9 % sobre el cierre 2026");
    expect(cuenta(s, "Importante</span>")).toBe(5);
    expect(s).not.toContain("informativas");
    for (const t of ["Aprobar", "Aprobar con observaciones", "Rechazar"]) expect(s).toMatch(new RegExp(`<button[^>]*role="radio"[^>]*>${t}</button>`));
    expect(s).toContain("Revisé las alertas y las cifras de toda la proyección");
    expect(cuenta(s, "min-h-11")).toBe(4);
    // Sin elegir todavía, no hay motivo ni comentario.
    expect(s).not.toContain("<textarea");
  });

  it("aprobar: comentario opcional; con observaciones o rechazar: motivo y comentario obligatorios con contador", () => {
    const aprobar = contenido({ formulario: f({ resultado: "aprobada" }) });
    expect(aprobar).toContain("Comentario (opcional)");
    expect(aprobar).not.toContain("Elige un motivo");
    const rechazar = contenido({ formulario: f({ resultado: "rechazada", comentario: "corto" }) });
    expect(rechazar).toContain("Comentario (obligatorio)");
    expect(rechazar).toContain("Elige un motivo");
    for (const m of ["Crecimiento alto", "Crecimiento bajo", "Contra la tendencia de venta", "Tiendas nuevas o aperturas", "Efecto del Niño", "Filas sin decidir", "Concentración en pocas filas", "Otro"]) expect(rechazar).toContain(`>${m}</option>`);
    expect(rechazar).toContain("5 de 1000 caracteres · mínimo 10 (faltan 5)");
  });

  it("en trabajo avisa qué pasa con la aprobación y lista primero lo que bloquearía el cierre (se puede aprobar igual)", () => {
    const s = contenido({ tablero: tableroEnTrabajo(), bloqueos: conBloqueos() });
    expect(s).toContain("Proyección 2026–2027 seguimiento oct (en trabajo)");
    expect(s).toContain("Si se cierra sin cambiar cifras, tu aprobación sigue vigente; si cambia una cifra, queda invalidada.");
    expect(s).toContain("Puedes aprobar igual: la aprobación es un juicio de dirección, no un control del cierre.");
    expect(s.indexOf("Bloquea el cierre")).toBeLessThan(s.indexOf("Importante</span>"));
  });

  it("409 huella_distinta: lo dice, ofrece «Recargar» y bloquea el formulario; no se registra nada", () => {
    const s = contenido({ formulario: f({ resultado: "aprobada", confirmo: true }), error: { mensaje: "La proyección cambió mientras la mirabas: vuelve a cargar el tablero", codigo: "huella_distinta" } });
    expect(s).toContain("La proyección cambió mientras la mirabas (alguien decidió o recalculó). Vuelve a cargar el tablero y revisa de nuevo. No se registró nada.");
    expect(s).toMatch(/<button[^>]*>Recargar<\/button>/);
    expect(cuenta(s, 'role="radio"')).toBe(3);
    expect(cuenta(s, "disabled")).toBeGreaterThanOrEqual(5);
    // Otro error de la API se muestra con su mensaje, sin «Recargar».
    const otro = contenido({ error: { mensaje: "Una proyección archivada no se aprueba.", codigo: "archivada" } });
    expect(otro).toContain("Una proyección archivada no se aprueba.");
    expect(otro).not.toContain(">Recargar</button>");
  });

  it("el diálogo: botones de 44 px, registrar deshabilitado hasta cumplir las reglas y sin poder decidir a medias", () => {
    const s = html(createElement(DecisionModal, { tablero: tablero(), filtros: FILTROS_VACIOS, bloqueos: sinBloqueos, onCerrar: noop, onRegistrada: noop, onRecargar: noop }));
    expect(s).toContain("Decisión de dirección");
    expect(s).toContain("No bloquea el cierre ni las compras.");
    expect(deshabilitado(boton(s, "Registrar decisión"))).toBe(true);
    expect(boton(s, "Registrar decisión")).toContain("h-11!");
    expect(boton(s, "Cancelar")).toContain("h-11!");
    expect(s).toContain("Elige aprobar, aprobar con observaciones o rechazar.");
    const fuenteModal = fuente(`${DIR}/decision-modal.tsx`);
    expect(fuenteModal).toContain("api.post<AprobacionApi>(`${RUTA_API_DIRECCION}/aprobaciones`, cuerpo)");
    expect(fuenteModal).toContain("disabled={accion.ocupado || falta !== null || huellaDistinta}");
  });

  it("el historial: fecha y hora de Lima, quién, resultado en texto, motivo, comentario, sobre qué y por qué quedó invalidada", () => {
    const s = html(createElement(HistorialAprobaciones, { historial: historial(), cargando: false, error: null }));
    expect(s.indexOf("08 nov 2026, 10:30")).toBeLessThan(s.indexOf("05 nov 2026, 09:00"));
    for (const t of ["Admin A.", "Aprobada", "Aprobada con observaciones", "Rechazada", "Crecimiento alto", "Efecto del Niño", "Revisar el crecimiento de MUJER · URBANO antes de comprar.", "en trabajo", "cerrada", "invalidada: la proyección cambió después", "invalidada por un cambio en el cálculo de la huella"]) expect(s).toContain(t);
    expect(html(createElement(HistorialAprobaciones, { historial: [], cargando: false, error: null }))).toContain("Esta proyección todavía no tiene decisiones de dirección.");
    expect(html(createElement(HistorialAprobaciones, { historial: null, cargando: false, error: "Falló", onReintentar: noop }))).toContain("No se pudo leer el historial: Falló");
  });
});

describe("avisos en Proyección y en Flujo mensual (no bloquean nada)", () => {
  it("cerrada sin aprobación vigente: alerta con quién cerró, cuándo, el estado en negrita, la diferencia y el enlace al tablero", () => {
    const s = html(createElement(AvisoDireccionVista, { estado: estadoDireccion(), contexto: "proyeccion" }));
    expect(s).toContain('role="alert"');
    expect(s).toContain("Cerrada por Planner P. el 07 nov 2026 · <strong>sin aprobación de dirección vigente</strong> · difiere de lo aprobado el 03 nov 2026 en +1,214 u en 2027 (+1.5 %).");
    expect(s).toContain(`href="/planificacion/aprobacion-direccion?proyeccion=${ID.proyeccion}"`);
    const flujo = html(createElement(AvisoDireccionVista, { estado: estadoDireccion(), contexto: "flujo" }));
    expect(flujo).toContain("El flujo usa Proyección 2026–2027, cerrada por Planner P. el 07 nov 2026 · <strong>sin aprobación de dirección vigente</strong>");
  });

  it("rechazada: alerta con el rechazo y su motivo; con aprobación vigente: una línea de texto, sin alerta", () => {
    const ultima = { resultado: "rechazada" as const, motivo: "nino" as const, usuario_nombre: "Admin A.", created_at: "2026-11-08T15:30:00Z" };
    const rechazada = html(createElement(AvisoDireccionVista, { estado: estadoDireccion({ estado: "rechazada", ultima }), contexto: "flujo" }));
    expect(rechazada).toContain('role="alert"');
    expect(rechazada).toContain("Dirección <strong>rechazó</strong> esta proyección el 08 nov 2026 (efecto del Niño)");
    const vigente = { resultado: "aprobada" as const, usuario_nombre: "Admin A.", created_at: "2026-11-08T15:30:00Z" };
    const aprobada = html(createElement(AvisoDireccionVista, { estado: estadoDireccion({ estado: "aprobada", vigente, ultima: { ...vigente, motivo: null } }), contexto: "proyeccion" }));
    expect(aprobada).not.toContain('role="alert"');
    expect(aprobada).toContain("Dirección: aprobada por Admin A. el 08 nov 2026");
    expect(html(createElement(AvisoDireccionVista, { estado: estadoDireccion({ proyeccion: proyeccionEnTrabajo() }), contexto: "proyeccion" }))).toContain("Dirección: sin aprobación de dirección");
    expect(html(createElement(AvisoDireccionVista, { estado: estadoDireccion({ proyeccion: null, diferencia: null }), contexto: "flujo" }))).toBe("");
  });

  it("el aviso lee /api/direccion/estado; mientras carga no ocupa lugar y un error se muestra sin tapar la pantalla", () => {
    expect(html(createElement(AvisoDireccion, { paraCompras: true, contexto: "flujo" }))).toBe("");
    expect(lecturas.pedidas).toEqual(["/api/direccion/estado?para=compras"]);
    lecturas.porRuta = new Map([["/api/direccion/estado", listo(estadoDireccion())]]);
    expect(html(createElement(AvisoDireccion, { proyeccionId: ID.proyeccion, contexto: "proyeccion" }))).toContain("sin aprobación de dirección vigente");
    expect(lecturas.pedidas.at(-1)).toBe(`/api/direccion/estado?proyeccion_id=${ID.proyeccion}`);
    lecturas.porRuta = new Map([["/api/direccion/estado", fallo("No se pudo leer", null)]]);
    expect(html(createElement(AvisoDireccion, { paraCompras: true, contexto: "flujo" }))).toContain("No se pudo comprobar la aprobación de dirección: No se pudo leer");
  });

  it("en Flujo mensual solo se monta para admin y planner; en Proyección va en la cabecera (la página es de admin y planner)", () => {
    const flujo = fuente("src/app/(app)/compras/flujo/flujo-panel.tsx");
    expect(flujo).toContain('const puedeEscribir = rol === "admin" || rol === "planner"');
    expect(flujo).toContain('{puedeEscribir && datos && <AvisoDireccion paraCompras contexto="flujo" />}');
    expect(cuenta(flujo, "<AvisoDireccion")).toBe(1);
    const cabecera = fuente("src/app/(app)/planificacion/proyeccion/cabecera-proyeccion.tsx");
    expect(cabecera).toContain('proyeccionId={proyeccion.id} contexto="proyeccion" />');
    expect(cuenta(cabecera, "<AvisoDireccion")).toBe(1);
    const pagina = fuente("src/app/(app)/planificacion/proyeccion/page.tsx");
    expect(pagina).toContain("!puedeEditarMaestros(r.rol)) redirect(\"/\")");
  });
});

describe("móvil (390 px): una columna, sin desplazamiento horizontal de la página", () => {
  it("las tablas anchas se desplazan dentro de su contenedor y nada fija un ancho mayor que la pantalla", () => {
    servir();
    const s = html(createElement(TableroPanel, { esAdmin: true }));
    // Todas las tablas van dentro de un contenedor con desplazamiento propio.
    expect(cuenta(s, "<table")).toBe(cuenta(s, '<div class="overflow-x-auto rounded-lg border border-borde"><table'));
    expect(cuenta(s, "<table")).toBeGreaterThanOrEqual(8);
    expect(s).not.toMatch(/min-width:\s*\d/);
    expect(s).not.toMatch(/\bw-\[\d{3,}px\]/);
    expect(s).not.toMatch(/\bmin-w-\[\d{3,}px\]/);
    // Tarjetas 2 × 2, filtros tras un botón, gráfico al ancho y «Decidir» fijo abajo.
    expect(s).toContain("grid grid-cols-2 gap-3 lg:grid-cols-4");
    expect(s).toMatch(/md:hidden"><button[^>]*>Filtros<\/button>/);
    expect(s).toContain('width="100%"');
    expect(s).toContain("fixed inset-x-0 bottom-0 z-30");
  });

  it("el texto solo para lector de pantalla va dentro de un `relative` (si no, dentro de una tabla desplazable ensancha la página)", () => {
    servir();
    const s = html(createElement(TableroPanel, { esAdmin: true }));
    const total = cuenta(s, 'class="sr-only"');
    expect(total).toBeGreaterThan(20);
    expect((s.match(/<span [^>]*class="relative[^"]*"[^>]*>[^<]*<span class="sr-only">/g) ?? []).length).toBe(total);
    const conDiferencia = html(createElement(Puente, { tablero: { ...tablero(), datos: { ...tablero().datos, tiendas: tablero().datos.tiendas.filter((t) => t.situacion !== "cierres") } } }));
    expect(conDiferencia).toContain(">diferencia<");
    expect((conDiferencia.match(/<span [^>]*class="relative[^"]*"[^>]*>[^<]*<span class="sr-only">/g) ?? []).length).toBe(cuenta(conDiferencia, 'class="sr-only"'));
  });
});
