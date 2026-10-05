/** Vista previa de cómo se guardará un nombre y su código. */
export function VistaPreviaNombre({ nombre, codigo }: { nombre: string; codigo: string }) {
  if (!nombre) return null;
  return (
    <p className="text-xs text-tinta-suave">
      Se guardará como <strong className="text-tinta">{nombre}</strong>
      {codigo && (
        <>
          {" "}
          con código <code className="font-mono text-tinta">{codigo}</code>
        </>
      )}
      .
    </p>
  );
}
