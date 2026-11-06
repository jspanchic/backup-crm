import { CalendarDays, MapPinned } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { PreviewPlaceholder } from "./PreviewPlaceholder";

/** The agenda in presentation mode: it opens, it loads nothing and it creates nothing. */
export const AgendaPreview = () => (
  <div className="mt-4 flex flex-col gap-4">
    <PreviewPlaceholder
      icon={CalendarDays}
      title="Agenda"
      description="Aquí verás las citas de cada aplicador y los horarios que ofrece Javier."
      actions={["Nueva cita", "Disponibilidad"]}
    />
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPinned className="h-4 w-4" />
          Citas agrupadas por zona, con descuento
        </CardTitle>
        <Badge variant="secondary">Próximamente · 20/11</Badge>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Cuando varias citas caigan en la misma zona el mismo día, la agenda las agrupará y Javier podrá ofrecer un
        descuento a esos clientes.
      </CardContent>
    </Card>
  </div>
);
