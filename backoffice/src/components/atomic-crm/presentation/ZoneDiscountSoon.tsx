import { MapPinned } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** What is still to come in the agenda. It shows a text only: it loads nothing and creates nothing. */
export const ZoneDiscountSoon = () => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between gap-2">
      <CardTitle className="flex items-center gap-2 text-base">
        <MapPinned className="h-4 w-4" />
        Citas agrupadas por zona, con descuento
      </CardTitle>
      <Badge variant="secondary">Próximamente · 20/11</Badge>
    </CardHeader>
    <CardContent className="text-sm text-muted-foreground">
      Cuando varias citas caigan en la misma zona el mismo día, la agenda las
      agrupará y Javier podrá ofrecer un descuento a esos clientes.
    </CardContent>
  </Card>
);