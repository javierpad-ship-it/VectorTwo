import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { plural } from "@/lib/formato";
import { mesLargo, unidades } from "./formato";

/** Ruta de la pestaña Conciliación con el chip «Por confirmar» (a donde lleva «Revisar»). */
export const RUTA_POR_CONFIRMAR = "/compras/flujo?pestana=conciliacion&solo=por_confirmar";

export type ResumenPorConfirmar = { entregas: number; unidades: number; con_respaldo_entregas: number; con_respaldo_unidades: number };

/**
 * Aviso compartido «Por confirmar» (ficha 08, §0.5): entregas vencidas que nadie confirmó y que el flujo sigue esperando. Si alguna
 * ya tiene un ingreso sin registrar en el inventario publicado, avisa del posible doble conteo. Lo usan la cabecera de Huecos, la de
 * Flujo mensual y la de Compras. `mes` es el primer mes del horizonte (`k'+1`), donde el flujo las sigue contando. «Revisar» abre la
 * conciliación (`href`) o, en Compras, activa el filtro de la lista (`onRevisar`). Sin entregas por confirmar no pinta nada.
 */
export function AvisoPorConfirmar({ resumen, mes, href = RUTA_POR_CONFIRMAR, onRevisar }: { resumen: ResumenPorConfirmar; mes?: string; href?: string; onRevisar?: () => void }) {
  if (resumen.entregas <= 0) return null;
  const respaldo = resumen.con_respaldo_entregas > 0;
  return (
    <Alert tono="alerta">
      <strong>{plural(resumen.entregas, "entrega vencida sin confirmar", "entregas vencidas sin confirmar")}</strong> ({unidades(resumen.unidades)} u) que el
      flujo sigue esperando{mes ? ` en ${mesLargo(mes)}` : ""}.
      {respaldo ? (
        <>
          {" "}
          En {resumen.con_respaldo_entregas === 1 ? "1 de ellas" : `${resumen.con_respaldo_entregas} de ellas`} ({unidades(resumen.con_respaldo_unidades)} u) el inventario publicado ya muestra
          un ingreso sin registrar: <strong>posible doble conteo</strong>.
        </>
      ) : (
        <> Si ya llegaron, se cuentan dos veces hasta que confirmes su ingreso.</>
      )}{" "}
      {onRevisar ? (
        <button type="button" onClick={onRevisar} className="font-semibold underline underline-offset-2">
          Revisar
        </button>
      ) : (
        <Link href={href} className="font-semibold underline underline-offset-2">
          Revisar
        </Link>
      )}
    </Alert>
  );
}
