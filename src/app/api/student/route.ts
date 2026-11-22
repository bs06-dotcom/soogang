import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { safeErrorMessage } from "@/lib/validation";
import { readJsonBody, RequestBodyError } from "@/lib/request";

export const runtime = "nodejs";

const errorCodes = new Set([
  "NOT_STARTED", "COURSE_CODE_MISMATCH", "STUDENT_AUTH_FAILED", "ALREADY_REGISTERED",
  "COURSE_CLOSED", "COURSE_FULL", "TOTAL_LIMIT", "CATEGORY_LIMIT", "CANCEL_CLOSED",
  "ADMIN_REQUIRED", "INVALID_INPUT", "RATE_LIMITED", "NOT_FOUND",
]);

export async function POST(request: Request) {
  try {
    const parsed = await readJsonBody(request, 2_000_000);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "요청 정보를 확인해주세요." }, { status: 400 });
    }
    const body = parsed as { action?: string; payload?: unknown };
    if (typeof body.action !== "string" || !body.action || body.action.length > 40 || !body.payload || typeof body.payload !== "object") {
      return NextResponse.json({ error: "요청 정보를 확인해주세요." }, { status: 400 });
    }

    const { data, error } = await getSupabaseClient().rpc("student_api", {
      p_action: body.action,
      p_payload: body.payload,
    });
    if (error) {
      const details = error.details ?? "";
      const code = errorCodes.has(details) || details.startsWith("CATEGORY_LIMIT|")
        ? details
        : undefined;
      const categoryLimit = code?.match(/^CATEGORY_LIMIT\|(.{1,40})\|([1-5])$/);
      const categoryMessage = categoryLimit
        ? `${categoryLimit[1]} 범주에서는 최대 ${categoryLimit[2]}개 과목까지 신청할 수 있습니다.`
        : safeErrorMessage(code);
      return NextResponse.json({ error: categoryMessage }, {
        status: code === "RATE_LIMITED" ? 429 : code === "INVALID_INPUT" ? 400 : 400,
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
