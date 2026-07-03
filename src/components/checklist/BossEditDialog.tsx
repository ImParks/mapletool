"use client";

import { useEffect, useState } from "react";
import { Lock, TriangleAlert } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Checkbox } from "@/components/ui/Checkbox";
import { Button } from "@/components/ui/Button";
import type { BossPresetDTO } from "@/app/main/MainScreenClient";
import { cn } from "@/lib/cn";

interface BossStatsState {
  status: "idle" | "loading" | "loaded" | "error";
  arcaneForce?: number;
  authenticForce?: number;
}

interface BossEditDialogProps {
  open: boolean;
  /** 편집 대상 캐릭터. open=false 이거나 대상이 없으면 null. */
  character: { ocid: string; name: string; level: number } | null;
  bossPresets: BossPresetDTO[];
  /** null = 이 캐릭터에 대한 선택 행이 하나도 없음(전체 보스 선택으로 간주). */
  initialSelected: string[] | null;
  onClose: () => void;
  /** "완료" 클릭 시 호출. 다이얼로그는 즉시 닫히고, 저장(서버 액션 호출 등)은 호출자가 처리한다. */
  onSave: (characterOcid: string, selectedItemIds: string[]) => void;
}

/**
 * 보스 선택 편집 다이얼로그(#9). 열릴 때 편집 대상 캐릭터의 ocid로 스탯(아케인/어센틱 포스)을
 * 지연 조회한다(호버 상태창과 동일 패턴 — 전체 캐릭터를 미리 불러오지 않음).
 * rec_hexa(권장 헥사)는 캐릭터의 헥사 스탯 데이터가 없어 판정에 쓰지 않는다(정보로도 이 화면에서는
 * 표시하지 않음 — 디자인 소스에도 힘/레벨 기준 배지만 있음).
 */
export function BossEditDialog({ open, character, bossPresets, initialSelected, onClose, onSave }: BossEditDialogProps) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [stats, setStats] = useState<BossStatsState>({ status: "idle" });

  // 다이얼로그가 열리거나 대상 캐릭터가 바뀌면 체크 상태를 그 캐릭터 기준으로 초기화하고
  // 스탯을 새로 조회한다.
  useEffect(() => {
    if (!open || !character) return;
    setChecked(initialSelected === null ? new Set(bossPresets.map((b) => b.id)) : new Set(initialSelected));
    setStats({ status: "loading" });

    let cancelled = false;
    fetch(`/api/characters/${character.ocid}/stats`)
      .then((res) => res.json())
      .then((data: { arcaneForce?: number; authenticForce?: number; error?: string }) => {
        if (cancelled) return;
        if (data.error) {
          setStats({ status: "error" });
        } else {
          setStats({ status: "loaded", arcaneForce: data.arcaneForce ?? 0, authenticForce: data.authenticForce ?? 0 });
        }
      })
      .catch(() => {
        if (!cancelled) setStats({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bossPresets/initialSelected 는 open/ocid 전환 시점 스냅샷만 필요
  }, [open, character?.ocid]);

  if (!character) return null;

  function toggle(bossId: string, locked: boolean) {
    if (locked) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(bossId)) next.delete(bossId);
      else next.add(bossId);
      return next;
    });
  }

  function handleComplete() {
    if (!character) return;
    onSave(character.ocid, Array.from(checked));
    onClose();
  }

  return (
    <Dialog
      open={open}
      title={`${character.name} · 보스 편집`}
      description="이 캐릭터가 실제로 잡는 보스만 선택하세요. 선택 해제한 보스는 숙제 목록·진행률·소요시간 계산에서 빠집니다."
      onClose={onClose}
      widthClassName="max-w-[420px]"
    >
      <div className="flex flex-col">
        {bossPresets.length === 0 ? (
          <p className="px-1 py-4 text-xs font-semibold text-maple-text-muted">등록된 주간 보스 프리셋이 없어요.</p>
        ) : (
          bossPresets.map((boss) => {
            const locked = boss.reqLevel != null && character.level < boss.reqLevel;
            const isChecked = !locked && checked.has(boss.id);

            let recNote: string | null = null;
            if (!locked && stats.status === "loaded" && boss.symbolType && boss.reqForce != null && boss.reqForce > 0) {
              const myForce = boss.symbolType === "authentic" ? (stats.authenticForce ?? 0) : (stats.arcaneForce ?? 0);
              if (myForce < boss.reqForce) {
                const label = boss.symbolType === "authentic" ? "어센틱 포스" : "아케인 포스";
                recNote = `${label} ${boss.reqForce.toLocaleString()}+ 권장`;
              }
            }

            return (
              <label
                key={boss.id}
                htmlFor={`boss-edit-${boss.id}`}
                className={cn(
                  "flex min-h-11 items-center gap-3 border-b border-maple-line-subtle px-1 py-[11px] last:border-b-0",
                  locked ? "cursor-not-allowed" : "cursor-pointer"
                )}
              >
                <Checkbox
                  id={`boss-edit-${boss.id}`}
                  checked={isChecked}
                  disabled={locked}
                  onChange={() => toggle(boss.id, locked)}
                  ariaLabel={boss.name}
                />
                <div className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-sm font-semibold",
                      locked ? "text-maple-text-disabled" : "text-maple-text-primary"
                    )}
                  >
                    {boss.name}
                  </span>
                  {locked && boss.reqLevel != null && (
                    <div className="mt-[3px] flex items-center gap-1 text-[11px] font-bold text-maple-text-muted">
                      <Lock className="h-[11px] w-[11px] flex-none" aria-hidden="true" />
                      Lv.{boss.reqLevel} 이상 필요
                    </div>
                  )}
                  {recNote && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-maple-warning-soft px-1.5 py-0.5 text-[10.5px] font-extrabold text-maple-warning">
                      <TriangleAlert className="h-[11px] w-[11px] flex-none" aria-hidden="true" />
                      권장하지 않음 · {recNote}
                    </div>
                  )}
                </div>
              </label>
            );
          })
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="button" variant="primary" size="sm" onClick={handleComplete}>
          완료
        </Button>
      </div>
    </Dialog>
  );
}
