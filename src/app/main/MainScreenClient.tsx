"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Check, ChevronRight, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { IconButton } from "@/components/ui/IconButton";
import { Logo } from "@/components/ui/Logo";
import { NexonKeyCard } from "@/components/settings/NexonKeyCard";
import { ChecklistSection } from "@/components/checklist/ChecklistSection";
import { ChecklistRow } from "@/components/checklist/ChecklistRow";
import { DurationInput } from "@/components/checklist/DurationInput";
import { CATEGORY_LABEL, CATEGORY_ORDER, type ChecklistCategory } from "@/lib/presets";
import type { ResetType } from "@/lib/period";
import { cn } from "@/lib/cn";
import { saveDuration, toggleCompletion } from "./actions";

export interface ChecklistItemDTO {
  id: string;
  name: string;
  category: ChecklistCategory;
  resetType: ResetType;
}

export interface CharacterDTO {
  ocid: string;
  name: string;
  characterClass: string;
  level: number;
  world: string;
  imageUrl: string | null;
  /** null = 이 캐릭터에 대한 선택 행이 하나도 없음(전체 보스 선택으로 간주). */
  bossItemIds: string[] | null;
  /** 현재 주기 기준 완료된 item id 목록(서버에서 currentPeriodKey 로 이미 필터링됨). */
  doneItemIds: string[];
}

interface MainScreenClientProps {
  items: ChecklistItemDTO[];
  characters: CharacterDTO[];
  durations: Record<string, number>;
  nexonKeyRegistered: boolean;
  nexonKeyMasked: string | null;
}

interface HoverStat {
  status: "loading" | "loaded" | "error";
  combatPower?: number | null;
  arcaneForce?: number;
  authenticForce?: number;
}

const CATEGORY_LABEL_SHORT: Record<ChecklistCategory, string> = { daily: "일일", weekly: "주간", boss: "보스" };
const CATEGORY_TEXT_CLASS: Record<ChecklistCategory, string> = {
  daily: "text-maple-category-daily",
  weekly: "text-maple-category-weekly",
  boss: "text-maple-category-boss",
};
const CATEGORY_BG_CLASS: Record<ChecklistCategory, string> = {
  daily: "bg-maple-category-daily",
  weekly: "bg-maple-category-weekly",
  boss: "bg-maple-category-boss",
};
const CATEGORY_SOFT_CLASS: Record<ChecklistCategory, string> = {
  daily: "bg-maple-category-daily/[.13] text-maple-category-daily",
  weekly: "bg-maple-category-weekly/[.12] text-maple-category-weekly",
  boss: "bg-maple-category-boss/[.13] text-maple-category-boss",
};

function formatMinutes(total: number): string | null {
  if (!total || total <= 0) return null;
  if (total < 60) return `${total}분`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
}

export function MainScreenClient({
  items,
  characters,
  durations: initialDurations,
  nexonKeyRegistered,
  nexonKeyMasked,
}: MainScreenClientProps) {
  const router = useRouter();
  const [, startRefresh] = useTransition();

  const worlds = useMemo(() => {
    const seen: string[] = [];
    for (const c of characters) {
      if (!seen.includes(c.world)) seen.push(c.world);
    }
    return seen;
  }, [characters]);

  const [selectedWorld, setSelectedWorld] = useState<string | null>(worlds[0] ?? null);
  const worldChars = useMemo(
    () => characters.filter((c) => c.world === selectedWorld),
    [characters, selectedWorld]
  );
  const [selectedOcid, setSelectedOcid] = useState<string | null>(worldChars[0]?.ocid ?? null);
  const selectedChar = useMemo(
    () => characters.find((c) => c.ocid === selectedOcid) ?? null,
    [characters, selectedOcid]
  );

  // 완료 상태(캐릭터별 · 낙관적). key: `${ocid}::${itemId}`
  const [doneMap, setDoneMap] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of characters) {
      for (const id of c.doneItemIds) init[`${c.ocid}::${id}`] = true;
    }
    return init;
  });
  const [pendingKeys, setPendingKeys] = useState<Record<string, boolean>>({});
  const [durations, setDurations] = useState<Record<string, number>>(initialDurations);
  const [toastError, setToastError] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const [hoverOcid, setHoverOcid] = useState<string | null>(null);
  const [popup, setPopup] = useState<{ top: number; left: number } | null>(null);
  const [hoverStats, setHoverStats] = useState<Record<string, HoverStat>>({});

  function relevantItemsFor(char: CharacterDTO): ChecklistItemDTO[] {
    const bossSet = char.bossItemIds === null ? null : new Set(char.bossItemIds);
    return items.filter((i) => i.category !== "boss" || bossSet === null || bossSet.has(i.id));
  }

  function progressFor(char: CharacterDTO) {
    const rel = relevantItemsFor(char);
    const categories = CATEGORY_ORDER.map((cat) => {
      const catItems = rel.filter((i) => i.category === cat);
      const doneItems = catItems.filter((i) => doneMap[`${char.ocid}::${i.id}`]);
      const remainMinutes = catItems
        .filter((i) => !doneMap[`${char.ocid}::${i.id}`])
        .reduce((sum, i) => sum + (durations[i.id] ?? 0), 0);
      const totalMinutes = catItems.reduce((sum, i) => sum + (durations[i.id] ?? 0), 0);
      return {
        category: cat,
        items: catItems,
        done: doneItems.length,
        total: catItems.length,
        remainMinutes,
        totalMinutes,
      };
    });
    const done = categories.reduce((sum, c) => sum + c.done, 0);
    const total = categories.reduce((sum, c) => sum + c.total, 0);
    return { categories, done, total };
  }

  function handleToggle(ocid: string, itemId: string) {
    const key = `${ocid}::${itemId}`;
    if (pendingKeys[key]) return; // 연타/중복 클릭 방지
    const prev = !!doneMap[key];
    setDoneMap((m) => ({ ...m, [key]: !prev }));
    setPendingKeys((p) => ({ ...p, [key]: true }));

    toggleCompletion(ocid, itemId)
      .then((result) => {
        if ("error" in result) {
          setDoneMap((m) => ({ ...m, [key]: prev }));
          setToastError(result.error);
        }
      })
      .catch(() => {
        setDoneMap((m) => ({ ...m, [key]: prev }));
        setToastError("완료 처리 중 오류가 발생했습니다.");
      })
      .finally(() => {
        setPendingKeys((p) => {
          const next = { ...p };
          delete next[key];
          return next;
        });
      });
  }

  function handleBulkComplete(char: CharacterDTO, category: ChecklistCategory) {
    const rel = relevantItemsFor(char).filter((i) => i.category === category);
    for (const item of rel) {
      const key = `${char.ocid}::${item.id}`;
      if (!doneMap[key]) handleToggle(char.ocid, item.id);
    }
  }

  function handleDurationSave(itemId: string, minutes: number) {
    const prev = durations[itemId] ?? 0;
    setDurations((d) => ({ ...d, [itemId]: minutes }));
    saveDuration(itemId, minutes)
      .then((result) => {
        if ("error" in result) {
          setDurations((d) => ({ ...d, [itemId]: prev }));
          setToastError(result.error);
        }
      })
      .catch(() => {
        setDurations((d) => ({ ...d, [itemId]: prev }));
        setToastError("소요시간 저장 중 오류가 발생했습니다.");
      });
  }

  function handleSelectWorld(world: string) {
    setSelectedWorld(world);
    const first = characters.find((c) => c.world === world);
    setSelectedOcid(first ? first.ocid : null);
    setHoverOcid(null);
    setPopup(null);
  }

  function handleSelectCharacter(ocid: string) {
    setSelectedOcid(ocid);
    setHoverOcid(null);
    setPopup(null);
  }

  function handleSync() {
    setIsSyncing(true);
    window.setTimeout(() => setIsSyncing(false), 820);
    startRefresh(() => router.refresh());
  }

  function handleGoHome() {
    setSelectedWorld(worlds[0] ?? null);
    const first = characters.find((c) => c.world === (worlds[0] ?? null));
    setSelectedOcid(first ? first.ocid : null);
    setHoverOcid(null);
    setPopup(null);
  }

  function handleHoverEnter(ocid: string, rect: DOMRect) {
    const width = 300;
    const gap = 14;
    const estimatedHeight = 300;
    let left = rect.right + gap;
    if (left + width > window.innerWidth - 12) {
      left = rect.left - width - gap;
    }
    if (left < 12) left = 12;
    let top = rect.top + rect.height / 2 - estimatedHeight / 2;
    top = Math.max(12, Math.min(top, window.innerHeight - estimatedHeight - 12));
    setHoverOcid(ocid);
    setPopup({ top, left });

    if (!hoverStats[ocid]) {
      setHoverStats((s) => ({ ...s, [ocid]: { status: "loading" } }));
      fetch(`/api/characters/${ocid}/stats`)
        .then((res) => res.json())
        .then((data: { combatPower?: number | null; arcaneForce?: number; authenticForce?: number; error?: string }) => {
          if (data.error) {
            setHoverStats((s) => ({ ...s, [ocid]: { status: "error" } }));
          } else {
            setHoverStats((s) => ({
              ...s,
              [ocid]: {
                status: "loaded",
                combatPower: data.combatPower ?? null,
                arcaneForce: data.arcaneForce ?? 0,
                authenticForce: data.authenticForce ?? 0,
              },
            }));
          }
        })
        .catch(() => setHoverStats((s) => ({ ...s, [ocid]: { status: "error" } })));
    }
  }

  function handleHoverLeave(ocid: string) {
    setHoverOcid((cur) => (cur === ocid ? null : cur));
    setPopup((p) => (hoverOcid === ocid ? null : p));
  }

  const hoverChar = hoverOcid ? characters.find((c) => c.ocid === hoverOcid) ?? null : null;
  const hoverStat = hoverOcid ? hoverStats[hoverOcid] : undefined;
  const hoverProgress = hoverChar ? progressFor(hoverChar) : null;

  return (
    <div className="relative z-10">
      <div className="sticky top-0 z-[100] border-b border-maple-line-subtle bg-white/[.86] backdrop-blur-[10px]">
        <div className="mx-auto flex max-w-[1080px] items-center gap-2.5 px-5 py-[11px]">
          <button type="button" onClick={handleGoHome} aria-label="홈" className="flex items-center">
            <Logo size="sm" />
          </button>
          <span className="flex-1" />
          <IconButton ariaLabel="캐릭터 동기화" onClick={handleSync}>
            <RefreshCw className={cn("h-[18px] w-[18px]", isSyncing && "animate-maple-spin")} aria-hidden="true" />
          </IconButton>
          <IconButton ariaLabel="설정" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon className="h-[18px] w-[18px]" aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      <div className="mx-auto max-w-[1080px] px-5 pb-16 pt-6">
        <div className="flex flex-col gap-[22px]">
          <div>
            <h1 className="text-2xl font-extrabold sm:text-[26px]">오늘의 숙제</h1>
            <p className="mt-1.5 text-[13.5px] text-maple-text-secondary">
              월드를 고르면 캐릭터가 펼쳐져요 · 캐릭터를 클릭하면 상세 숙제를 볼 수 있어요
            </p>
          </div>

          {toastError && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-xl bg-maple-danger-soft px-3.5 py-2.5 text-xs font-semibold text-maple-danger"
            >
              {toastError}
              <button type="button" onClick={() => setToastError(null)} aria-label="닫기" className="font-extrabold">
                ×
              </button>
            </div>
          )}

          {characters.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-maple-line bg-maple-surface-raised px-6 py-12 text-center">
              <p className="text-sm font-semibold text-maple-text-secondary">연동된 캐릭터를 찾지 못했어요.</p>
              <p className="max-w-[36ch] text-xs text-maple-text-muted">
                넥슨 API 키에 연결된 계정에 캐릭터가 있는지 확인한 뒤 다시 동기화해 주세요.
              </p>
              <Button variant="secondary" size="sm" onClick={handleSync}>
                다시 동기화
              </Button>
            </div>
          ) : (
            <>
              <div>
                <div className="mb-2.5 text-xs font-extrabold tracking-[.04em] text-maple-text-muted">월드</div>
                <div className="flex flex-wrap gap-2">
                  {worlds.map((world) => {
                    const count = characters.filter((c) => c.world === world).length;
                    const active = world === selectedWorld;
                    return (
                      <button
                        key={world}
                        type="button"
                        onClick={() => handleSelectWorld(world)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-extrabold transition-colors duration-180 ease-standard",
                          active
                            ? "border-maple-orange bg-maple-orange text-maple-text-onaccent shadow-glow-orange"
                            : "border-maple-line bg-maple-surface-card text-maple-text-secondary hover:bg-maple-surface-raised"
                        )}
                      >
                        {world}
                        <span className="text-xs font-bold tabular-nums opacity-70">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2.5 text-xs font-extrabold tracking-[.04em] text-maple-text-muted">
                  {selectedWorld} 캐릭터{" "}
                  <span className="text-maple-text-secondary tabular-nums">{worldChars.length}</span>
                </div>
                <div className="flex gap-3 overflow-x-auto px-0.5 pb-3 pt-0.5" style={{ scrollSnapType: "x proximity" }}>
                  {worldChars.map((char) => {
                    const progress = progressFor(char);
                    const complete = progress.total > 0 && progress.done >= progress.total;
                    const selected = char.ocid === selectedOcid;
                    return (
                      <div
                        key={char.ocid}
                        onMouseEnter={(event) => handleHoverEnter(char.ocid, event.currentTarget.getBoundingClientRect())}
                        onMouseLeave={() => handleHoverLeave(char.ocid)}
                        className={cn(
                          "flex w-[200px] flex-none flex-col overflow-hidden rounded-2xl border bg-maple-surface-card shadow-sm transition-[transform,box-shadow] duration-180 ease-out hover:-translate-y-[3px] hover:shadow-md",
                          selected ? "border-maple-orange shadow-glow-orange" : "border-maple-line"
                        )}
                        style={{ scrollSnapAlign: "start" }}
                      >
                        <div
                          className="relative h-[152px] w-full"
                          style={{ background: "radial-gradient(120% 100% at 50% 4%, #efeafb, #e5e9f4)" }}
                        >
                          {char.imageUrl ? (
                            <Image
                              src={char.imageUrl}
                              alt={`${char.name} 캐릭터 이미지`}
                              fill
                              sizes="200px"
                              className="object-contain"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs font-semibold text-maple-text-muted">
                              이미지 없음
                            </div>
                          )}
                          <span className="pointer-events-none absolute bottom-2 left-2 rounded-[7px] border border-[#ffe0c2] bg-white/[.92] px-[7px] py-[2px] text-[10.5px] font-extrabold tabular-nums text-maple-orange-300">
                            Lv.{char.level}
                          </span>
                          {complete && (
                            <span className="pointer-events-none absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-maple-success text-white shadow-glow-success">
                              <Check className="h-3.5 w-3.5" strokeWidth={3.2} aria-hidden="true" />
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSelectCharacter(char.ocid)}
                          className="flex w-full flex-col gap-2.5 border-t border-maple-line-subtle p-3.5 text-left"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[15px] font-extrabold text-maple-text-primary">{char.name}</div>
                            <div className="truncate text-[11.5px] tabular-nums text-maple-text-muted">
                              {char.characterClass}
                            </div>
                          </div>
                          <div className="flex flex-col gap-2">
                            {progress.categories.map((cat) => {
                              const pct = cat.total ? Math.round((cat.done / cat.total) * 100) : 0;
                              const timeLabel = formatMinutes(cat.remainMinutes);
                              return (
                                <div key={cat.category} className="flex items-center gap-2">
                                  <span
                                    className={cn(
                                      "w-[26px] flex-none text-[11px] font-extrabold",
                                      CATEGORY_TEXT_CLASS[cat.category]
                                    )}
                                  >
                                    {CATEGORY_LABEL_SHORT[cat.category]}
                                  </span>
                                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-maple-surface-inset">
                                    <div
                                      className={cn("h-full rounded-full", CATEGORY_BG_CLASS[cat.category])}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <span className="flex w-11 flex-none flex-col items-end leading-[1.05]">
                                    <span className="text-[11px] font-extrabold tabular-nums text-maple-text-secondary">
                                      {cat.done}/{cat.total}
                                    </span>
                                    {timeLabel && (
                                      <span className="mt-[1px] whitespace-nowrap text-[9px] font-bold text-maple-text-muted">
                                        ~{timeLabel}
                                      </span>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {selectedChar && (
                <div className="flex flex-col gap-4 border-t border-maple-line-subtle pt-5">
                  {progressFor(selectedChar).categories.map((cat) => (
                    <ChecklistSection
                      key={cat.category}
                      category={cat.category}
                      done={cat.done}
                      total={cat.total}
                      remainLabel={formatMinutes(cat.remainMinutes)}
                      totalLabel={formatMinutes(cat.totalMinutes)}
                      onBulkComplete={() => handleBulkComplete(selectedChar, cat.category)}
                    >
                      {cat.items.map((item) => {
                        const key = `${selectedChar.ocid}::${item.id}`;
                        return (
                          <div key={item.id} className="flex items-center gap-1.5">
                            <ChecklistRow
                              id={`row-${key}`}
                              name={item.name}
                              resetType={item.resetType}
                              done={!!doneMap[key]}
                              disabled={!!pendingKeys[key]}
                              onToggle={() => handleToggle(selectedChar.ocid, item.id)}
                              className="min-w-0 flex-1"
                            />
                            <DurationInput
                              itemName={item.name}
                              committedMinutes={durations[item.id] ?? 0}
                              onSave={(minutes) => handleDurationSave(item.id, minutes)}
                            />
                          </div>
                        );
                      })}
                    </ChecklistSection>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {hoverChar && popup && hoverProgress && (
        <div className="pointer-events-none fixed z-[350] w-[300px]" style={{ top: popup.top, left: popup.left }}>
          <div className="animate-maple-pop rounded-2xl border border-maple-line bg-maple-surface-overlay p-4 shadow-lg motion-reduce:animate-none [box-shadow:var(--shadow-lg),var(--inner-highlight)]">
            <div className="flex items-center gap-2.5 border-b border-maple-line-subtle pb-3">
              <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-maple-line bg-maple-surface-raised text-lg font-extrabold text-maple-text-secondary">
                {hoverChar.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[15px] font-extrabold text-maple-text-primary">{hoverChar.name}</div>
                <div className="mt-0.5 truncate text-[11.5px] tabular-nums text-maple-text-muted">
                  Lv.{hoverChar.level} · {hoverChar.characterClass} · {hoverChar.world}
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <StatChip
                label="전투력"
                value={
                  hoverStat?.status === "loaded"
                    ? hoverStat.combatPower != null
                      ? hoverStat.combatPower.toLocaleString()
                      : "—"
                    : hoverStat?.status === "error"
                      ? "—"
                      : "…"
                }
              />
              {/* TODO: 헥사 스탯 — 연동된 넥슨 엔드포인트가 없어 생략(헥사 매트릭스 API 확보 시 추가) */}
              <StatChip label="헥사 스탯" value="—" />
              <StatChip
                label="아케인 포스"
                value={
                  hoverStat?.status === "loaded"
                    ? (hoverStat.arcaneForce ?? 0).toLocaleString()
                    : hoverStat?.status === "error"
                      ? "—"
                      : "…"
                }
              />
              <StatChip
                label="어센틱 포스"
                value={
                  hoverStat?.status === "loaded"
                    ? (hoverStat.authenticForce ?? 0).toLocaleString()
                    : hoverStat?.status === "error"
                      ? "—"
                      : "…"
                }
              />
            </div>

            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs font-bold text-maple-text-secondary">오늘 숙제</span>
              <span
                className={cn(
                  "text-[15px] font-extrabold tabular-nums",
                  hoverProgress.total > 0 && hoverProgress.done >= hoverProgress.total
                    ? "text-maple-success-text"
                    : "text-maple-text-primary"
                )}
              >
                {hoverProgress.done}
                <span className="text-xs font-normal text-maple-text-muted">/{hoverProgress.total}</span>
              </span>
            </div>
            <div className="mt-[7px] h-2 overflow-hidden rounded-full bg-maple-surface-inset">
              <div
                className={cn(
                  "h-full rounded-full",
                  hoverProgress.total > 0 && hoverProgress.done >= hoverProgress.total
                    ? "bg-maple-success"
                    : "bg-maple-orange"
                )}
                style={{
                  width: `${hoverProgress.total ? Math.round((hoverProgress.done / hoverProgress.total) * 100) : 0}%`,
                }}
              />
            </div>

            <div className="mt-3.5 flex flex-col gap-2.5">
              {hoverProgress.categories.map((cat) => {
                const pct = cat.total ? Math.round((cat.done / cat.total) * 100) : 0;
                const timeLabel = formatMinutes(cat.remainMinutes);
                return (
                  <div key={cat.category}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-extrabold", CATEGORY_SOFT_CLASS[cat.category])}>
                        {CATEGORY_LABEL[cat.category]}
                      </span>
                      <span className="text-xs font-extrabold tabular-nums text-maple-text-secondary">
                        {cat.done}/{cat.total}
                        {timeLabel && <span className="font-bold text-maple-text-muted"> · ~{timeLabel}</span>}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-maple-surface-inset">
                      <div className={cn("h-full rounded-full", CATEGORY_BG_CLASS[cat.category])} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-maple-text-muted">
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
              클릭하면 숙제 상세 보기
            </div>
          </div>
        </div>
      )}

      <Dialog open={settingsOpen} title="설정" onClose={() => setSettingsOpen(false)}>
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-maple-line bg-maple-surface-card p-4">
            <NexonKeyCard registered={nexonKeyRegistered} maskedKey={nexonKeyMasked} />
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setSettingsOpen(false)}>
              닫기
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-maple-surface-inset px-2.5 py-2">
      <div className="text-[10px] font-bold tracking-[.02em] text-maple-text-muted">{label}</div>
      <div className="mt-0.5 truncate text-sm font-extrabold tabular-nums text-maple-text-primary">{value}</div>
    </div>
  );
}
