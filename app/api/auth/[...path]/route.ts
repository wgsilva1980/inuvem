import { getAuth } from "@/lib/auth/server";

type Handlers = ReturnType<ReturnType<typeof getAuth>["handler"]>;

let handlers: Handlers | undefined;
const resolve = (): Handlers => (handlers ??= getAuth().handler());

export const GET: Handlers["GET"] = (...args) => resolve().GET(...args);
export const POST: Handlers["POST"] = (...args) => resolve().POST(...args);
