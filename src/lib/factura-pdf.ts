import jsPDF from "jspdf";

export interface FacturaPdfLinea {
  descripcion: string;
  cantidad: number;
  precio: number;
  subtotal: number;
  // Solo conduces: unidad de medida que se muestra junto a la cantidad.
  unidad?: string | null;
}

export interface FacturaPdfData {
  // Documento (permite reusar este generador para cotizaciones)
  documentTitle?: string; // default: "FACTURA"
  clienteLabel?: string; // default: "FACTURAR A"

  // Empresa emisora
  companyName: string;
  companyRnc?: string | null;
  companyAddress?: string | null;
  companyPhone?: string | null;
  companyEmail?: string | null;
  companyLogoUrl?: string | null;

  // Factura
  ncf: string;
  fechaEmision: string;
  fechaVencimiento?: string | null;
  // Texto ya formateado sobre la condición/plazo del documento, p. ej.
  // "Crédito — 30 días (vence 20/10/2026)" o "Válida por 30 días (vence
  // 20/10/2026)". Si no se provee pero sí fechaVencimiento, se muestra
  // "Vencimiento: <fecha>" como antes.
  condicionTexto?: string | null;
  estado: string;
  // Título de la columna derecha (por defecto "ESTADO"). En cotizaciones se usa
  // "VÁLIDA HASTA" con la fecha en `estado`, para no exponer el estado interno
  // (Borrador, Enviada…) al cliente.
  estadoTitulo?: string;

  // Cliente
  clienteNombre: string;
  clienteDocumento?: string | null;
  clienteEmail?: string | null;
  clienteTelefono?: string | null;
  clienteDireccion?: string | null;

  // Importes
  lineas: FacturaPdfLinea[];
  subtotal: number;
  descuento?: number;
  itbis?: number;
  total: number;
  montoPagado?: number;
  saldoPendiente?: number;

  // ── Conduces (notas de entrega) ──
  // Oculta precios, subtotal y totales: solo descripción y cantidad.
  ocultarPrecios?: boolean;
  // Datos de entrega (dirección, transportista, vehículo…) bajo la tabla.
  datosEntrega?: Array<{ label: string; value: string }>;
  notas?: string | null;
  // Recuadros de firma al final (p. ej. "Despachado por", "Recibido por").
  firmas?: string[];
  // Texto del pie (por defecto "Gracias por su preferencia.").
  piePagina?: string;
}

const RD = (n: number) =>
  "RD$" +
  Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function loadImageAsDataUrl(url: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 1, h: 1 });
      img.src = dataUrl;
    });
    return { data: dataUrl, w: dims.w, h: dims.h };
  } catch {
    return null;
  }
}

export async function generateFacturaPdf(d: FacturaPdfData): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const left = 48;
  const right = pageW - 48;

  // ----- Header: logo (left) + título (right) -----
  let yLogoBottom = 60;
  if (d.companyLogoUrl) {
    const img = await loadImageAsDataUrl(d.companyLogoUrl);
    if (img) {
      const maxW = 150;
      const maxH = 90;
      const ratio = Math.min(maxW / img.w, maxH / img.h);
      const w = img.w * ratio;
      const h = img.h * ratio;
      try {
        doc.addImage(img.data, "PNG", left, 48, w, h);
      } catch {
        try {
          doc.addImage(img.data, "JPEG", left, 48, w, h);
        } catch { /* skip */ }
      }
      yLogoBottom = 48 + h;
    }
  }

  const title = d.documentTitle || "FACTURA";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(20, 28, 56);
  doc.text(title, right, 70, { align: "right" });

  doc.setFontSize(11);
  doc.setTextColor(20, 28, 56);
  doc.text(`N°: ${d.ncf}`, right, 90, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`Fecha Emisión: ${d.fechaEmision}`, right, 106, { align: "right" });
  const terminoTexto = d.condicionTexto || (d.fechaVencimiento ? `Vencimiento: ${d.fechaVencimiento}` : null);
  if (terminoTexto) {
    const terminoLines = doc.splitTextToSize(terminoTexto, 220);
    doc.text(terminoLines, right, 120, { align: "right" });
  }

  // ----- Nombre de la empresa (siempre visible, con o sin logo) -----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(20, 28, 56);
  doc.text(d.companyName || "", left, yLogoBottom + 16);

  // ----- Datos empresa emisora -----
  let y = Math.max(yLogoBottom + 36, 176);
  doc.setTextColor(90);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (d.companyRnc) { doc.text(`RNC: ${d.companyRnc}`, left, y); y += 14; }
  if (d.companyAddress) {
    const lines = doc.splitTextToSize(d.companyAddress, pageW - 96);
    doc.text(lines, left, y);
    y += 14 * lines.length;
  }
  if (d.companyPhone) { doc.text(d.companyPhone, left, y); y += 14; }
  if (d.companyEmail) { doc.text(d.companyEmail, left, y); y += 14; }

  y += 8;
  doc.setDrawColor(220);
  doc.line(left, y, right, y);
  y += 24;

  // ----- FACTURAR A + ESTADO -----
  const midX = left + (right - left) / 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 28, 56);
  doc.text(d.clienteLabel || "FACTURAR A", left, y);
  doc.text(d.estadoTitulo || "ESTADO", midX + 20, y);

  doc.setDrawColor(220);
  doc.line(left, y + 6, midX - 10, y + 6);
  doc.line(midX + 20, y + 6, right, y + 6);

  y += 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20);
  // El nombre puede ser largo: se ajusta al ancho de su columna para no
  // montarse sobre el estado (columna derecha).
  const nombreLineas: string[] = doc.splitTextToSize(d.clienteNombre || "—", midX - 10 - left);
  doc.text(nombreLineas, left, y);
  doc.text(d.estado.toUpperCase(), midX + 20, y);
  y += 15 * (nombreLineas.length - 1);

  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`RNC/Cédula: ${d.clienteDocumento || "N/A"}`, left, y); y += 14;
  if (d.clienteEmail) { doc.text(`Email: ${d.clienteEmail}`, left, y); y += 14; }
  if (d.clienteTelefono) { doc.text(`Tel: ${d.clienteTelefono}`, left, y); y += 14; }
  if (d.clienteDireccion) {
    const lines = doc.splitTextToSize(`Dirección: ${d.clienteDireccion}`, midX - 10 - left);
    doc.text(lines, left, y);
    y += 14 * lines.length;
  }

  y += 20;

  // ----- Tabla de líneas -----
  const colDesc = left + 12;
  const colCant = left + 320;
  const colPrec = left + 400;
  const colSub = right - 12;

  const sinPrecios = !!d.ocultarPrecios;
  const colCantX = sinPrecios ? colSub : colCant;
  const pageH = doc.internal.pageSize.getHeight();
  const encabezadoTabla = () => {
    doc.setFillColor(241, 245, 249);
    doc.rect(left, y, right - left, 28, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(20, 28, 56);
    doc.text("Descripción", colDesc, y + 18);
    doc.text("Cantidad", colCantX, y + 18, { align: "right" });
    if (!sinPrecios) {
      doc.text("Precio Unit.", colPrec, y + 18, { align: "right" });
      doc.text("Subtotal", colSub, y + 18, { align: "right" });
    }
    y += 36;
  };
  encabezadoTabla();

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(20);
  for (const ln of d.lineas) {
    const descLines = doc.splitTextToSize(ln.descripcion || "—", sinPrecios ? 360 : 280);
    // Salto de página si la línea no cabe (deja espacio para el pie).
    if (y + 14 * descLines.length > pageH - 110) {
      doc.addPage();
      y = 60;
      encabezadoTabla();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(20);
    }
    doc.text(descLines, colDesc, y);
    doc.text(sinPrecios && ln.unidad ? `${ln.cantidad} ${ln.unidad}` : String(ln.cantidad), colCantX, y, { align: "right" });
    if (!sinPrecios) {
      doc.text(RD(ln.precio), colPrec, y, { align: "right" });
      doc.text(RD(ln.subtotal), colSub, y, { align: "right" });
    }
    y += 14 * descLines.length + 8;
    doc.setDrawColor(235);
    doc.line(left, y - 4, right, y - 4);
  }

  y += 16;

  // ----- Conduce: datos de entrega, notas y firmas -----
  if (sinPrecios) {
    const needed = 40 + (d.datosEntrega?.length ?? 0) * 16 + (d.notas ? 50 : 0) + (d.firmas?.length ? 110 : 0);
    if (y + needed > pageH - 90) { doc.addPage(); y = 60; }
    if (d.datosEntrega?.length) {
      doc.setFontSize(10);
      for (const it of d.datosEntrega) {
        doc.setFont("helvetica", "bold"); doc.setTextColor(20, 28, 56);
        doc.text(`${it.label}:`, left, y);
        doc.setFont("helvetica", "normal"); doc.setTextColor(60);
        const vl = doc.splitTextToSize(it.value, right - left - 130);
        doc.text(vl, left + 130, y);
        y += 16 * vl.length;
      }
      y += 6;
    }
    if (d.notas) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(20, 28, 56);
      doc.text("Notas:", left, y);
      doc.setFont("helvetica", "normal"); doc.setTextColor(60);
      const nl = doc.splitTextToSize(d.notas, right - left - 50);
      doc.text(nl, left + 50, y);
      y += 14 * nl.length + 8;
    }
    if (d.firmas?.length) {
      y += 36;
      const n = d.firmas.length;
      const gap = 24;
      const w = (right - left - gap * (n - 1)) / n;
      d.firmas.forEach((label, i) => {
        const x = left + i * (w + gap);
        doc.setDrawColor(120);
        doc.line(x, y, x + w, y);
        doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(20, 28, 56);
        doc.text(label, x + w / 2, y + 14, { align: "center" });
        doc.setFont("helvetica", "normal"); doc.setTextColor(120);
        doc.text("Nombre, cédula, firma y fecha", x + w / 2, y + 26, { align: "center" });
      });
      y += 40;
    }
  }

  // ----- Totales -----
  const totLabelX = left + 320;
  const totValX = right;

  const row = (label: string, value: string, opts?: { bold?: boolean; color?: [number, number, number]; size?: number }) => {
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.size ?? 10);
    doc.setTextColor(90);
    doc.text(label, totLabelX, y);
    if (opts?.color) doc.setTextColor(...opts.color);
    else doc.setTextColor(20);
    doc.text(value, totValX, y, { align: "right" });
    y += (opts?.size ?? 10) + 8;
  };

  if (!sinPrecios) {
    row("Subtotal:", RD(d.subtotal), { bold: true });
    if (d.descuento && d.descuento > 0) row("Descuento:", "− " + RD(d.descuento));
    if (d.itbis && d.itbis > 0) row("ITBIS:", RD(d.itbis));

    y += 4;
    doc.setDrawColor(220);
    doc.line(totLabelX, y - 8, right, y - 8);
    y += 6;

    row("TOTAL:", RD(d.total), { bold: true, size: 14, color: [37, 99, 235] });

    if (d.montoPagado && d.montoPagado > 0) {
      row("Monto Pagado:", RD(d.montoPagado), { bold: true, color: [22, 163, 74] });
    }
    if (typeof d.saldoPendiente === "number") {
      row("Saldo Pendiente:", RD(d.saldoPendiente), { bold: true });
    }
  }

  // ----- Footer -----
  doc.setDrawColor(230);
  doc.line(left, pageH - 70, right, pageH - 70);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(140);
  doc.text(d.piePagina || "Gracias por su preferencia.", pageW / 2, pageH - 50, { align: "center" });
  doc.setFontSize(9);
  doc.text("Generado por IngreSaaS - Software de Contabilidad", pageW / 2, pageH - 34, { align: "center" });

  return doc;
}