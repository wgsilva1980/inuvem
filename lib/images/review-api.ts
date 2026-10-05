import { getImage, updateImage } from "@/lib/nuvemshop";
import type { NuvemshopClient } from "@/lib/nuvemshop/client";
import type { AltApi } from "./review";

export const altApiDoCliente = (client: NuvemshopClient): AltApi => ({
  updateAlt: (pid, iid, alt) => updateImage(client, pid, iid, { alt }),
  getImage: (pid, iid) => getImage(client, pid, iid),
});
