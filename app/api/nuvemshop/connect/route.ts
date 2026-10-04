import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireAdminApi } from "@/lib/auth/admin";
import { getEnv } from "@/lib/env";
import { authorizeUrl } from "@/lib/nuvemshop";

export async function GET() {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;

  const state = randomBytes(16).toString("base64url");
  (await cookies()).set("ns_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/nuvemshop",
  });
  return Response.redirect(authorizeUrl(getEnv().NUVEMSHOP_APP_ID, state), 302);
}
