"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCharacterList } from "@/lib/maple";

export interface NexonKeyState {
  error: string | null;
  success: boolean;
}

export const initialNexonKeyState: NexonKeyState = { error: null, success: false };

/**
 * 넥슨 API 키 등록/교체. getCharacterList 로 실제 조회가 되는지 검증한 뒤 user_secrets 에
 * upsert 한다. 넥슨 원본 에러 텍스트는 그대로 노출하지 않는다(민감할 수 있음).
 */
export async function saveNexonKey(_prevState: NexonKeyState, formData: FormData): Promise<NexonKeyState> {
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (!apiKey) {
    return { error: "API 키를 입력해 주세요.", success: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "로그인이 필요합니다.", success: false };
  }

  try {
    await getCharacterList(apiKey);
  } catch {
    return { error: "API 키가 유효하지 않습니다. 키를 다시 확인해 주세요.", success: false };
  }

  const { error } = await supabase
    .from("user_secrets")
    .upsert({ user_id: user.id, nexon_api_key: apiKey, nexon_key_valid: true }, { onConflict: "user_id" });

  if (error) {
    return { error: "키 저장 중 오류가 발생했습니다.", success: false };
  }

  revalidatePath("/main");
  return { error: null, success: true };
}

/** 등록된 넥슨 API 키 삭제(행 자체를 삭제). */
export async function deleteNexonKey(): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "로그인이 필요합니다." };
  }

  const { error } = await supabase.from("user_secrets").delete().eq("user_id", user.id);
  if (error) {
    return { error: "삭제 중 오류가 발생했습니다." };
  }

  revalidatePath("/main");
  return { error: null };
}
