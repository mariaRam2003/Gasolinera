const COMPANY_NAME = "Gasolinera";
const REPORT_TITLE = "Corte diario de ventas";

function formatMoney(value) {
  return `Q${Number(value || 0).toLocaleString("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatGallons(value) {
  return `${Number(value || 0).toLocaleString("es-GT", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })} gal`;
}

function formatDate(date) {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function fuelName(id) {
  const names = {
    super: "Súper",
    regular: "Regular",
    diesel: "Diésel",
  };

  return names[id] || id;
}

function calculateTotals(sales) {
  const totals = {
    q: 0,
    g: 0,
    ef: 0,
    ta: 0,
  };

  sales.forEach((sale) => {
    const q = Number(sale.q || 0);
    const gal = Number(sale.gal || 0);

    totals.q += q;
    totals.g += gal;

    if (sale.pay === "efectivo") {
      totals.ef += q;
    } else {
      totals.ta += q;
    }
  });

  return totals;
}

function fuelSummary(sales) {
  const fuels = ["super", "regular", "diesel"];

  return fuels.map((fuel) => {
    const fuelSales = sales.filter((sale) => sale.fuel === fuel);

    return {
      fuel,
      name: fuelName(fuel),
      sales: fuelSales.length,
      gallons: fuelSales.reduce((sum, sale) => sum + Number(sale.gal || 0), 0),
      total: fuelSales.reduce((sum, sale) => sum + Number(sale.q || 0), 0),
    };
  });
}

export function exportExcel(sales, date) {
  if (!window.XLSX) {
    throw new Error("La librería de Excel no está disponible.");
  }

  const totals = calculateTotals(sales);
  const summary = fuelSummary(sales);

  const workbook = XLSX.utils.book_new();

  /*
   * HOJA 1: RESUMEN
   */
  const summaryRows = [
    [COMPANY_NAME],
    [REPORT_TITLE],
    ["Fecha", formatDate(date)],
    [],
    ["RESUMEN GENERAL"],
    ["Ventas", sales.length],
    ["Galones vendidos", totals.g],
    ["Ventas totales", totals.q],
    ["Efectivo", totals.ef],
    ["Tarjeta", totals.ta],
    [],
    ["POR COMBUSTIBLE"],
    ["Combustible", "Ventas", "Galones", "Total"],
    ...summary.map((item) => [item.name, item.sales, item.gallons, item.total]),
    ["TOTAL", sales.length, totals.g, totals.q],
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);

  summarySheet["!cols"] = [{ wch: 24 }, { wch: 15 }, { wch: 18 }, { wch: 18 }];

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumen");

  /*
   * HOJA 2: DETALLE
   */
  const detailRows = [
    ["ID", "Fecha", "Hora", "Combustible", "Forma de pago", "Galones", "Total"],
    ...sales.map((sale) => {
      const created = new Date(sale.created_at);

      return [
        sale.id,
        formatDate(date),
        created.toLocaleTimeString("es-GT", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
        fuelName(sale.fuel),
        sale.pay === "efectivo" ? "Efectivo" : "Tarjeta",
        Number(sale.gal || 0),
        Number(sale.q || 0),
      ];
    }),
  ];

  const detailSheet = XLSX.utils.aoa_to_sheet(detailRows);

  detailSheet["!cols"] = [
    { wch: 12 },
    { wch: 14 },
    { wch: 10 },
    { wch: 16 },
    { wch: 18 },
    { wch: 14 },
    { wch: 16 },
  ];

  XLSX.utils.book_append_sheet(workbook, detailSheet, "Detalle");

  const filename = `corte-${date}.xlsx`;

  XLSX.writeFile(workbook, filename);
}

export function exportPDF(sales, date) {
  if (!window.jspdf) {
    throw new Error("La librería PDF no está disponible.");
  }

  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "letter",
  });

  const totals = calculateTotals(sales);
  const summary = fuelSummary(sales);

  /*
   * ENCABEZADO
   */
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(COMPANY_NAME, 14, 18);

  doc.setFontSize(13);
  doc.setFont("helvetica", "normal");
  doc.text(REPORT_TITLE, 14, 26);

  doc.setFontSize(10);
  doc.text(`Fecha: ${formatDate(date)}`, 14, 33);

  /*
   * RESUMEN
   */
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Resumen general", 14, 44);

  doc.autoTable({
    startY: 48,
    head: [["Concepto", "Valor"]],
    body: [
      ["Ventas", sales.length.toString()],
      ["Galones vendidos", formatGallons(totals.g)],
      ["Ventas totales", formatMoney(totals.q)],
      ["Efectivo", formatMoney(totals.ef)],
      ["Tarjeta", formatMoney(totals.ta)],
    ],
    theme: "grid",
    styles: {
      fontSize: 9,
      cellPadding: 3,
    },
  });

  /*
   * COMBUSTIBLES
   */
  const fuelStartY = doc.lastAutoTable.finalY + 10;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Ventas por combustible", 14, fuelStartY);

  doc.autoTable({
    startY: fuelStartY + 4,
    head: [["Combustible", "Ventas", "Galones", "Total"]],
    body: [
      ...summary.map((item) => [
        item.name,
        item.sales.toString(),
        formatGallons(item.gallons),
        formatMoney(item.total),
      ]),
      [
        "TOTAL",
        sales.length.toString(),
        formatGallons(totals.g),
        formatMoney(totals.q),
      ],
    ],
    theme: "grid",
    styles: {
      fontSize: 9,
      cellPadding: 3,
    },
    headStyles: {
      fontStyle: "bold",
    },
  });

  /*
   * DETALLE
   */
  const detailStartY = doc.lastAutoTable.finalY + 10;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Detalle de ventas", 14, detailStartY);

  doc.autoTable({
    startY: detailStartY + 4,
    head: [["Hora", "Combustible", "Pago", "Galones", "Total"]],
    body: sales
      .slice()
      .reverse()
      .map((sale) => {
        const created = new Date(sale.created_at);

        return [
          created.toLocaleTimeString("es-GT", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
          fuelName(sale.fuel),
          sale.pay === "efectivo" ? "Efectivo" : "Tarjeta",
          formatGallons(sale.gal),
          formatMoney(sale.q),
        ];
      }),
    theme: "striped",
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
    },
  });

  /*
   * PIE
   */
  const pageCount = doc.internal.getNumberOfPages();

  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");

    doc.text(`Generado el ${new Date().toLocaleString("es-GT")}`, 14, 285);

    doc.text(`Página ${page} de ${pageCount}`, 196, 285, { align: "right" });
  }

  doc.save(`corte-${date}.pdf`);
}
