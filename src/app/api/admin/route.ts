import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { safeErrorMessage } from "@/lib/validation";
import { readJsonBody, RequestBodyError } from "@/lib/request";

export const runtime = "nodejs";

const errorCodes = new Set([
  "ADMIN_REQUIRED", "INVALID_INPUT", "RATE_LIMITED", "NOT_FOUND", "COURSE_FULL",
]);

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.match(/^Bearer ([\w.-]+)$/)?.[1];
    if (!token) return NextResponse.json({ error: "관리자 로그인이 필요합니다." }, { status: 401 });

    const parsed = await readJsonBody(request, 2_000_000);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "요청 정보를 확인해주세요." }, { status: 400 });
    }
    const body = parsed as { action?: string; payload?: unknown };
    if (typeof body.action !== "string" || body.action.length > 40 || !body.payload || typeof body.payload !== "object") {
      return NextResponse.json({ error: "요청 정보를 확인해주세요." }, { status: 400 });
    }
    const { data, error } = await getSupabaseClient(token).rpc("admin_api", {
      p_action: body.action,
      p_payload: body.payload,
    });
    if (error) {
      const code = errorCodes.has(error.details ?? "") ? error.details! : undefined;
      return NextResponse.json({ error: safeErrorMessage(code) }, {
        status: code === "ADMIN_REQUIRED" ? 403 : code === "INVALID_INPUT" ? 400 : 400,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    if (reason instanceof RequestBodyError) {
      return NextResponse.json(
        { error: reason.message === "too_large" ? "요청 크기가 너무 큽니다." : "요청 정보를 확인해주세요." },
        { status: reason.message === "too_large" ? 413 : 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
