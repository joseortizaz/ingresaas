import { generateFacturaPdf } from "@/lib/factura-pdf";
import { fmtDate } from "@/lib/format";

// Arma el PDF de un conduce con el mismo generador de facturas y cotizaciones,
// sin precios ni totales y con recuadros de firma.
export async function generateConducePdf(args: {
  conduce: any; // fila de `conduces` con clientes(...) y facturas(ncf)
  lineas: Array<{ descripcion: string; cantidad: number | string; unidad?: string | null }>;
  empresa: {
    razon_social?: string | null;
    nombre_comercial?: string | null;
    rnc?: string | null;
    direccion?: string | null;
    telefono?: string | null;
    logoUrl?: string | null;
  };
}) {
  const { conduce: con, lineas, empresa: t } = args;
  const c: any = con.clientes ?? {};
  const datos: Array<{ label: string; value: string }> = [];
  if (con.direccion_entrega) datos.push({ label: "Dirección de entrega", value: con.direccion_entrega });
  if (con.transportista) datos.push({ label: "Transportista", value: con.transportista });
  if (con.vehiculo) datos.push({ label: "Vehículo / placa", value: con.vehiculo });
  if (con.facturas?.ncf) datos.push({ label: "Factura relacionada", value: con.facturas.ncf });

  return generateFacturaPdf({
    documentTitle: "CONDUCE",
    clienteLabel: "ENTREGAR A",
    companyName: t.nombre_comercial || t.razon_social || "",
    companyRnc: t.rnc,
    companyAddress: t.direccion,
    companyPhone: t.telefono,
    companyEmail: null,
    companyLogoUrl: t.logoUrl ?? null,
    ncf: con.numero,
    fechaEmision: fmtDate(con.fecha),
    // Igual que en cotizaciones, el estado interno (borrador…) no se imprime.
    estadoTitulo: "FECHA DE ENTREGA",
    estado: con.fecha_entrega ? fmtDate(con.fecha_entrega) : "Por confirmar",
    clienteNombre: c.razon_social || "—",
    clienteDocumento: c.documento,
    clienteEmail: c.email,
    clienteTelefono: c.telefono,
    clienteDireccion: c.direccion,
    lineas: lineas.map((l) => ({
      descripcion: l.descripcion,
      cantidad: Number(l.cantidad),
      unidad: l.unidad ?? "und",
      precio: 0,
      subtotal: 0,
    })),
    subtotal: 0,
    total: 0,
    ocultarPrecios: true,
    datosEntrega: datos,
    notas: con.notas,
    firmas: ["Despachado por", "Recibido por"],
    piePagina: "Recibí conforme la mercancía descrita en este conduce.",
  });
}
