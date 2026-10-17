"use client";

import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { motivoRechazoTienda } from "@/lib/tiendas/reglas";
import { TIPOS_TIENDA_API, type EditarTiendaCuerpo, type TiendaFila, type TipoTienda } from "@/lib/tiendas/tipos-api";
import { Field, Input, Select } from "@/components/ui/form";
import { leerMontoInput } from "./comunes";
import { AYUDA_VENTA_MENSUAL } from "./venta-esperada";

/** Lo que el usuario escribe (fechas ISO del `type="date"`, venta como texto). */
export type Campos = {
  codigo: string;
  nombre: string;
  tipo: TipoTienda;
  zona: string;
  razon_social: string;
  fecha_apertura: string;
  fecha_cierre: string;
  venta: string;
  /** M7: id de la tienda de referencia (`""` = sin referente). */
  referencia: string;
};

export const FORM_VACIO: Campos = {
  codigo: "",
  nombre: "",
  tipo: "Tienda",
  zona: "",
  razon_social: "",
  fecha_apertura: "",
  fecha_cierre: "",
  venta: "",
  referencia: "",
};

/** Fila resultante (alta o actual más cambio) tal como la ven `estadoTienda` y `motivoRechazoTienda`. */
type FilaResultante = {
  codigo: string;
  nombre: string;
  tipo: TipoTienda;
  zona: string | null;
  razon_social: string | null;
  fecha_apertura: string | null;
  fecha_cierre: string | null;
  venta_esperada_promedio: number | null;
};

export function aFila(c: Campos): FilaResultante {
  const venta = leerMontoInput(c.venta);
  return {
    codigo: aCodigo(c.codigo),
    nombre: normalizarNombre(c.nombre),
    tipo: c.tipo,
    zona: normalizarNombre(c.zona) || null,
    razon_social: normalizarNombre(c.razon_social) || null,
    fecha_apertura: c.fecha_apertura || null,
    fecha_cierre: c.fecha_cierre || null,
    venta_esperada_promedio: Number.isNaN(venta) ? null : venta,
  };
}

/** Motivo por el que no se puede guardar (cliente), o `null`. Corre antes que la API. */
export function motivoNoGuardar(c: Campos): string | null {
  const fila = aFila(c);
  if (!fila.codigo) return "El código es obligatorio (letras o números).";
  if (!fila.nombre) return "El nombre es obligatorio.";
  if (Number.isNaN(leerMontoInput(c.venta))) return "La venta esperada debe ser un número.";
  return motivoRechazoTienda(fila)?.mensaje ?? null;
}

/** Campos de la tienda tal como los edita el diálogo. */
export function camposDeTienda(t: TiendaFila): Campos {
  return {
    codigo: t.codigo,
    nombre: t.nombre,
    tipo: t.tipo,
    zona: t.zona ?? "",
    razon_social: t.razon_social ?? "",
    fecha_apertura: t.fecha_apertura ?? "",
    fecha_cierre: t.fecha_cierre ?? "",
    venta: t.venta_esperada_promedio === null ? "" : String(t.venta_esperada_promedio),
    referencia: t.tienda_referencia_id ?? "",
  };
}

/** Solo los campos que cambiaron respecto a la fila; `null` si no cambió nada. */
export function cambiosDeEdicion(t: TiendaFila, campos: Campos): EditarTiendaCuerpo | null {
  const fila = aFila(campos);
  const cuerpo: EditarTiendaCuerpo = {};
  if (fila.codigo !== t.codigo) cuerpo.codigo = fila.codigo;
  if (fila.nombre !== t.nombre) cuerpo.nombre = fila.nombre;
  if (fila.tipo !== t.tipo) cuerpo.tipo = fila.tipo;
  if (fila.zona !== t.zona) cuerpo.zona = fila.zona;
  if (fila.razon_social !== t.razon_social) cuerpo.razon_social = fila.razon_social;
  if (fila.fecha_apertura !== t.fecha_apertura) cuerpo.fecha_apertura = fila.fecha_apertura;
  if (fila.fecha_cierre !== t.fecha_cierre) cuerpo.fecha_cierre = fila.fecha_cierre;
  if (fila.venta_esperada_promedio !== t.venta_esperada_promedio) cuerpo.venta_esperada_promedio = fila.venta_esperada_promedio;
  // M7: el referente solo se manda si cambió (una API sin el campo lo trae ausente = sin referente).
  if ((campos.referencia || null) !== (t.tienda_referencia_id ?? null)) cuerpo.tienda_referencia_id = campos.referencia || null;
  return Object.keys(cuerpo).length === 0 ? null : cuerpo;
}

/** Al pasar a CD se vacía la venta esperada (el campo queda deshabilitado). */
function conTipo(c: Campos, tipo: TipoTienda): Campos {
  return { ...c, tipo, venta: tipo === "Centro de Distribución" ? "" : c.venta, referencia: tipo === "Centro de Distribución" ? "" : c.referencia };
}

/** Al quitar la apertura se vacía el cierre (sin apertura no hay cierre). */
function conApertura(c: Campos, fecha_apertura: string): Campos {
  return { ...c, fecha_apertura, fecha_cierre: fecha_apertura ? c.fecha_cierre : "" };
}

/**
 * Campos de la tienda (los comparten el alta y el diálogo de edición). Son hijos
 * directos de una grilla `md:grid-cols-4`; `idLista` es el prefijo de los
 * `<datalist>` de zonas y razones sociales ya usadas.
 */
export function CamposTienda({
  valor,
  onCambio,
  idLista,
  autoFocus = false,
  tiendasReferencia,
  idActual,
}: {
  valor: Campos;
  onCambio: (c: Campos) => void;
  idLista: string;
  /** Foco inicial en el primer campo (para el diálogo; el alta no debe robar el foco de la página). */
  autoFocus?: boolean;
  /** M7: tiendas que pueden ser referente (tipo Tienda, activas). Sin lista, el campo no se muestra. */
  tiendasReferencia?: readonly Pick<TiendaFila, "id" | "codigo" | "nombre">[];
  /** La tienda que se edita (no puede ser su propio referente). */
  idActual?: string;
}) {
  const esCd = valor.tipo === "Centro de Distribución";
  const cierreAntes = Boolean(valor.fecha_apertura && valor.fecha_cierre && valor.fecha_cierre < valor.fecha_apertura);
  const codigoFinal = aCodigo(valor.codigo);

  return (
    <>
      <Field
        label="Código"
        hint={valor.codigo.trim() === "" ? "Obligatorio. Ej. R401, RD50." : codigoFinal ? `Se guardará como ${codigoFinal}` : "El código es obligatorio (letras o números)."}
      >
        <Input
          required
          autoFocus={autoFocus}
          value={valor.codigo}
          onChange={(e) => onCambio({ ...valor, codigo: e.target.value })}
          className="font-mono"
          placeholder="R401"
        />
      </Field>
      <Field label="Nombre" className="md:col-span-2">
        <Input required value={valor.nombre} onChange={(e) => onCambio({ ...valor, nombre: e.target.value })} placeholder="Lukers Iquitos Lores" />
      </Field>
      <Field label="Tipo">
        <Select value={valor.tipo} onChange={(e) => onCambio(conTipo(valor, e.target.value as TipoTienda))}>
          {TIPOS_TIENDA_API.map((tipo) => (
            <option key={tipo} value={tipo}>
              {tipo}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Zona" hint="Opcional. Se autocompleta con las zonas ya usadas.">
        <Input value={valor.zona} list={`${idLista}-zonas`} onChange={(e) => onCambio({ ...valor, zona: e.target.value })} />
      </Field>
      <Field label="Razón social" hint="Opcional.">
        <Input value={valor.razon_social} list={`${idLista}-razones`} onChange={(e) => onCambio({ ...valor, razon_social: e.target.value })} />
      </Field>
      <Field label="Fecha de apertura" hint="Sin fecha, la tienda queda Planificada.">
        <Input type="date" value={valor.fecha_apertura} onChange={(e) => onCambio(conApertura(valor, e.target.value))} />
      </Field>
      <Field
        label="Fecha de cierre"
        hint={
          cierreAntes
            ? "La fecha de cierre no puede ser anterior a la de apertura."
            : valor.fecha_apertura
              ? "Último día con venta (inclusive)."
              : "Primero registra la apertura."
        }
      >
        <Input
          type="date"
          value={valor.fecha_cierre}
          min={valor.fecha_apertura || undefined}
          disabled={!valor.fecha_apertura}
          onChange={(e) => onCambio({ ...valor, fecha_cierre: e.target.value })}
        />
      </Field>
      <Field
        label="Venta mensual promedio esperada (S/, sin IGV)"
        hint={
          esCd
            ? "Un centro de distribución no vende."
            : AYUDA_VENTA_MENSUAL
        }
        className="md:col-span-2"
      >
        <Input
          type="number"
          step="0.01"
          min="0"
          value={valor.venta}
          disabled={esCd}
          onChange={(e) => onCambio({ ...valor, venta: e.target.value })}
          placeholder="850000"
        />
      </Field>
      {tiendasReferencia && (
        <Field
          label="Tienda de referencia"
          hint={
            esCd
              ? "Un centro de distribución no tiene referente."
              : "Opcional. Si esta tienda es nueva, su composición de venta (género, agrupación de marca) se parecerá a la de la referente; sin referente, al promedio de las mismas tiendas."
          }
          className="md:col-span-2"
        >
          <Select value={valor.referencia} disabled={esCd} onChange={(e) => onCambio({ ...valor, referencia: e.target.value })}>
            <option value="">Sin referente (promedio de la red)</option>
            {tiendasReferencia
              .filter((t) => t.id !== idActual)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.codigo} · {t.nombre}
                </option>
              ))}
          </Select>
        </Field>
      )}
    </>
  );
}
