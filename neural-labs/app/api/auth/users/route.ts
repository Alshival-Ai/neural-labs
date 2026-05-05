import { NextResponse } from "next/server";

import {
  createUserAsAdmin,
  listUsers,
  requireAdminViewerFromRequest,
} from "@/lib/server/auth";
import { jsonErrorFromUnknown } from "@/lib/server/http";
import type { AuthRole } from "@/lib/shared/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const viewer = requireAdminViewerFromRequest(request);
    return NextResponse.json({ users: listUsers(viewer) });
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to list users", 401);
  }
}

export async function POST(request: Request) {
  try {
    const viewer = requireAdminViewerFromRequest(request);
    const payload = (await request.json()) as {
      email?: string;
      role?: AuthRole;
      password?: string;
      generatePassword?: boolean;
    };
    return NextResponse.json(
      createUserAsAdmin(viewer, {
        email: payload.email ?? "",
        role: payload.role,
        password: payload.password,
        generatePassword: payload.generatePassword,
      })
    );
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to create user", 400);
  }
}
