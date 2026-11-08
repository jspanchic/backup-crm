// The text the scripted bot (and the live flow) sends with a quote. Every number comes from what `cotizar`
// answered; nothing is calculated here. The discount line only appears when the brand has the discount on.
const money = (value: number): string => value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export type QuoteAnswer = {
  pies_cubiertos: number;
  subtotal: number;
  descuento: number;
  descuento_aplicado?: boolean;
  impuesto?: number;
  impuesto_pct?: number;
  total: number;
  minimo_aplicado: boolean;
};

export const quoteMessage = (answer: Record<string, any>): string => {
  const quote = answer as QuoteAnswer;
  const lines = [`*COTIZACIÓN*`, `- Área cubierta: *${money(quote.pies_cubiertos)}* pies cuadrados`];
  if (quote.minimo_aplicado) {
    lines.push("- Valor mínimo por servicio.");
  } else {
    lines.push(`- Subtotal: *$${money(quote.subtotal)}*`);
    if (quote.descuento_aplicado !== false && quote.descuento > 0) lines.push(`- Descuento: *-$${money(quote.descuento)}*`);
  }
  if ((quote.impuesto ?? 0) > 0) lines.push(`- Impuesto (${quote.impuesto_pct}%): *$${money(quote.impuesto ?? 0)}*`);
  lines.push(`*VALOR ESTIMADO: $${money(quote.total)}*`);
  return lines.join("\n");
};