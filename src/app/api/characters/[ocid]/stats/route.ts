import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCharacterStat, getCharacterSymbolEquipment, MapleApiError } from "@/lib/maple";

/**
 * 캐릭터 호버 상태창용 스탯 지연 조회. 로그인 유저의 저장된 넥슨 키로 서버에서만 조회하고,
 * 응답에는 계산된 수치만 담는다(키 원문은 이 라우트 핸들러 스코프를 벗어나지 않는다).
 */
export async function GET(_request: Request, context: { params: Promise<{ ocid: string }> }) {
  const { ocid } = await context.params;
  if (!ocid) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data: secretRow } = await supabase
    .from("user_secrets")
    .select("nexon_api_key")
    .eq("user_id", user.id)
    .maybeSingle();

  const apiKey = secretRow?.nexon_api_key;
  if (!apiKey) {
    return NextResponse.json({ error: "넥슨 API 키가 등록되어 있지 않습니다." }, { status: 400 });
  }

  try {
    const [stat, symbols] = await Promise.all([
      getCharacterStat(apiKey, ocid),
      getCharacterSymbolEquipment(apiKey, ocid),
    ]);

    const combatPowerEntry = stat.final_stat.find((s) => s.stat_name === "전투력");
    const combatPower = combatPowerEntry ? Number(combatPowerEntry.stat_value) : null;

    // 아케인/어센틱 포스 합산 규칙: 정확한 넥슨 공식 합산 규칙 미확인, 추정치.
    // 각 그룹(아케인심볼/어센틱심볼) 심볼들의 symbol_force(문자열)를 그대로 합산한다.
    let arcaneForce = 0;
    let authenticForce = 0;
    for (const symbol of symbols.symbol) {
      const force = Number(symbol.symbol_force) || 0;
      if (symbol.symbol_name.startsWith("아케인심볼")) {
        arcaneForce += force;
      } else if (symbol.symbol_name.startsWith("어센틱심볼")) {
        authenticForce += force;
      }
    }

    return NextResponse.json({ combatPower, arcaneForce, authenticForce });
  } catch (error) {
    if (error instanceof MapleApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "캐릭터 정보를 불러오지 못했습니다." }, { status: 500 });
  }
}
