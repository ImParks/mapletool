"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Check, ChevronRight, EyeOff, ListChecks, RefreshCw, Settings as SettingsIcon, Shield, Star } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { IconButton } from "@/components/ui/IconButton";
import { Logo } from "@/components/ui/Logo";
import { ProgressOverlay } from "@/components/ui/ProgressOverlay";
import { Switch } from "@/components/ui/Switch";
import { useAppDialog } from "@/components/AppDialogProvider";
import { NexonKeyCard } from "@/components/settings/NexonKeyCard";
import { ChecklistSection } from "@/components/checklist/ChecklistSection";
import { ChecklistRow } from "@/components/checklist/ChecklistRow";
import { DurationInput } from "@/components/checklist/DurationInput";
import { BossEditDialog } from "@/components/checklist/BossEditDialog";
import {
  CATEGORY_BG_CLASS,
  CATEGORY_LABEL_SHORT,
  CATEGORY_SOFT_CLASS,
  CATEGORY_TEXT_CLASS,
} from "@/components/checklist/category-styles";
import { CATEGORY_LABEL, CATEGORY_ORDER, isBossCategory, type ChecklistCategory } from "@/lib/presets";
import type { ResetType } from "@/lib/period";
import { cn } from "@/lib/cn";
import { useCharacterWarmup } from "@/lib/character-warmup";
import { runAction, runVoidAction } from "@/lib/safe-action";
import {
  refreshCharacterSnapshot,
  saveDuration,
  setCharacterActive,
  syncSchedulerState,
  toggleCharacterFavorite,
  toggleCompletion,
} from "./actions";
import { saveBossSelection } from "./boss-selection-actions";
import { refreshCharacterList } from "./nexon-key-actions";
import { deleteAccountAction, resetAllCompletions, signOutAction } from "./settings-actions";

export interface ChecklistItemDTO {
  id: string;
  name: string;
  category: ChecklistCategory;
  resetType: ResetType;
}

export interface BossPresetDTO {
  id: string;
  name: string;
  resetType: ResetType;
  reqLevel: number | null;
  symbolType: "arcane" | "authentic" | null;
  reqForce: number | null;
  /** 권장 헥사 스탯. 캐릭터의 헥사 데이터를 아직 연동하지 않아 판정/표시에는 쓰지 않는다(TODO). */
  recHexa: number | null;
}

export interface CharacterDTO {
  ocid: string;
  name: string;
  characterClass: string;
  level: number;
  world: string;
  imageUrl: string | null;
  /** character_cache 캐시값(넥슨 라이브 호출 대체). null = 아직 "동기화"로 스탯을 조회한 적 없음. */
  combatPower: number | null;
  /** character_cache 캐시값. null = 아직 "동기화"로 스탯을 조회한 적 없음. */
  arcaneForce: number | null;
  /** character_cache 캐시값. null = 아직 "동기화"로 스탯을 조회한 적 없음. */
  authenticForce: number | null;
  /** null = 이 캐릭터에 대한 선택 행이 하나도 없음(전체 보스 선택으로 간주). */
  bossItemIds: string[] | null;
  /** 현재 주기 기준 완료된 item id 목록(서버에서 currentPeriodKey 로 이미 필터링됨). */
  doneItemIds: string[];
  /** 캐릭터 슬라이드 즐겨찾기 고정 여부(사용자가 별 아이콘으로 토글). */
  isFavorite: boolean;
  /** false 면 메인 슬라이드에서 숨김(설정의 "비활성 캐릭터" 목록에서만 노출·재활성화 가능). */
  isActive: boolean;
}

interface MainScreenClientProps {
  items: ChecklistItemDTO[];
  characters: CharacterDTO[];
  bossPresets: BossPresetDTO[];
  durations: Record<string, number>;
  nexonKeyRegistered: boolean;
  nexonKeyMasked: string | null;
  /** profiles.role === 'admin' 인 로그인 세션일 때만 true. 관리자 페이지 진입 아이콘 노출 여부. */
  isAdmin: boolean;
}

const HIDE_DONE_KEY = "mapletool:hideDone";
const AUTO_SORT_KEY = "mapletool:autoSort";
const COLLAPSED_CATEGORIES_KEY = "mapletool:collapsedCategories";

/**
 * 주간 보스 처치 보상은 잡는 보스 가짓수와 무관하게 **주 12회로 고정**이다(인게임 사양,
 * 2026-07-30 확인 — 일일 보스는 이 카운트에 포함되지 않고, 주간 보스만 잡을 때마다 차감된다).
 * "주간·월간 보스" 섹션의 진행바/배지 분모를 이 상수로 고정 표시한다 — 캐릭터가 보스를 몇
 * 마리 선택/추적하든 실제로 의미 있는 목표는 "이번 주 보상 12회를 채웠는가"이기 때문이다.
 */
const WEEKLY_BOSS_REWARD_CAP = 12;

/** 스냅샷 자동 보충을 시작하기 전 기다리는 시간. 캐릭터를 빠르게 훑을 때의 넥슨 호출 폭주를 막는다. */
const AUTO_SNAPSHOT_DELAY_MS = 500;

/** "동기화"(스탯) 성공 시 로컬에 낙관적으로 덮어쓰는 캐릭터 필드. characters prop 은 서버가 내려준
 * 값 그대로 유지하고(재조회 전까지 불변), 이 override 를 얹은 파생 배열(charactersView)만 화면에 쓴다. */
interface CharacterOverride {
  imageUrl: string | null;
  level: number;
  characterClass: string;
  combatPower: number | null;
  arcaneForce: number;
  authenticForce: number;
}

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
  bossPresets,
  durations: initialDurations,
  nexonKeyRegistered,
  nexonKeyMasked,
  isAdmin,
}: MainScreenClientProps) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  // 신규 캐릭터 순차 워밍업(진행률 오버레이). progress 는 아래 hoverProgress 등과 헷갈리지
  // 않도록 warmupProgress 로 받는다.
  const { progress: warmupProgress, warmUp, endWarmup } = useCharacterWarmup();
  // 에러/안내는 전부 모달로 띄운다 — 인라인 배너로 알리면 본문이 밀려 화면 구성이 달라 보인다.
  const { showError, showNotice } = useAppDialog();

  // "동기화" 버튼으로 갱신한 필드의 낙관적 override. characters(서버 prop) 자체는 건드리지 않고
  // charactersView 파생 배열에서만 병합해 화면에 반영한다.
  const [characterOverrides, setCharacterOverrides] = useState<Record<string, CharacterOverride>>({});
  const charactersView = useMemo(() => {
    if (Object.keys(characterOverrides).length === 0) return characters;
    return characters.map((c) => {
      const override = characterOverrides[c.ocid];
      return override ? { ...c, ...override } : c;
    });
  }, [characters, characterOverrides]);

  // 캐릭터별 활성 상태(낙관적). false 면 메인 슬라이드(월드 탭/카드)에서 완전히 빠진다 —
  // 데이터(완료 기록/보스 선택/견적시간)는 그대로 남고 노출만 바뀐다.
  const [activeMap, setActiveMap] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of characters) init[c.ocid] = c.isActive;
    return init;
  });
  // 캐릭터별 즐겨찾기(낙관적).
  const [favoriteMap, setFavoriteMap] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of characters) init[c.ocid] = c.isFavorite;
    return init;
  });

  function isActiveFor(char: CharacterDTO): boolean {
    return Object.prototype.hasOwnProperty.call(activeMap, char.ocid) ? activeMap[char.ocid] : char.isActive;
  }
  function isFavoriteFor(char: CharacterDTO): boolean {
    return Object.prototype.hasOwnProperty.call(favoriteMap, char.ocid) ? favoriteMap[char.ocid] : char.isFavorite;
  }

  // 메인 슬라이드(월드 탭 개수/카드 목록)가 공통으로 쓰는 "활성 캐릭터만" 파생값. 비활성
  // 캐릭터는 이 배열에서 완전히 빠지고, 설정 화면의 "비활성 캐릭터" 목록에서만 노출된다.
  const activeCharactersView = useMemo(
    () => charactersView.filter((c) => isActiveFor(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isActiveFor 는 activeMap 에 의존(이미 나열)
    [charactersView, activeMap]
  );
  const inactiveCharacters = useMemo(
    () => charactersView.filter((c) => !isActiveFor(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isActiveFor 는 activeMap 에 의존(이미 나열)
    [charactersView, activeMap]
  );

  const worlds = useMemo(() => {
    const seen: string[] = [];
    for (const c of activeCharactersView) {
      if (!seen.includes(c.world)) seen.push(c.world);
    }
    return seen;
  }, [activeCharactersView]);

  const [selectedWorld, setSelectedWorld] = useState<string | null>(worlds[0] ?? null);

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

  // 캐릭터별 "실제로 잡는" 주간 보스 선택(낙관적). null = 전체 선택(행 없음).
  const [bossSelectionMap, setBossSelectionMap] = useState<Record<string, string[] | null>>(() => {
    const init: Record<string, string[] | null> = {};
    for (const c of characters) init[c.ocid] = c.bossItemIds;
    return init;
  });
  const [bossEditOcid, setBossEditOcid] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // 표시 설정(설정 모달 "표시 설정" 블록) — 계정 간 동기화가 필요 없는 순수 표시 옵션이라
  // localStorage 에만 저장한다(LoginForm 의 "아이디 저장" 프리필과 동일 패턴: 마운트 후 hydrate).
  const [hideDone, setHideDoneState] = useState(false);
  const [autoSort, setAutoSortState] = useState(true);
  // 카테고리 섹션(일일/주간/일일보스/주간·월간보스)의 접힘 여부. 캐릭터가 아니라 "카테고리
  // 종류" 기준으로 저장한다 — "나는 항상 일일 항목을 접어두고 본다" 같은 취향이라 캐릭터를
  // 넘겨도 유지되는 게 자연스럽다(hideDone/autoSort 와 동일하게 표시 전용 로컬 설정).
  const [collapsedCategories, setCollapsedCategoriesState] = useState<Partial<Record<ChecklistCategory, boolean>>>(
    {}
  );

  useEffect(() => {
    const savedHideDone = window.localStorage.getItem(HIDE_DONE_KEY);
    if (savedHideDone !== null) setHideDoneState(savedHideDone === "1");
    const savedAutoSort = window.localStorage.getItem(AUTO_SORT_KEY);
    if (savedAutoSort !== null) setAutoSortState(savedAutoSort === "1");
    const savedCollapsed = window.localStorage.getItem(COLLAPSED_CATEGORIES_KEY);
    if (savedCollapsed !== null) {
      try {
        setCollapsedCategoriesState(JSON.parse(savedCollapsed));
      } catch {
        // 잘못된 JSON이면 기본값(전부 펼침) 유지
      }
    }
  }, []);

  function setHideDone(next: boolean) {
    setHideDoneState(next);
    window.localStorage.setItem(HIDE_DONE_KEY, next ? "1" : "0");
  }

  function setAutoSort(next: boolean) {
    setAutoSortState(next);
    window.localStorage.setItem(AUTO_SORT_KEY, next ? "1" : "0");
  }

  function toggleCategoryCollapsed(category: ChecklistCategory) {
    setCollapsedCategoriesState((prev) => {
      const next = { ...prev, [category]: !prev[category] };
      window.localStorage.setItem(COLLAPSED_CATEGORIES_KEY, JSON.stringify(next));
      return next;
    });
  }

  // 완료 기록 초기화(#8) / 로그아웃·회원탈퇴(#10) 확인 다이얼로그 + pending 상태.
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [deleteAccountConfirmOpen, setDeleteAccountConfirmOpen] = useState(false);
  const [isResetting, startResetTransition] = useTransition();
  const [isSigningOut, startSignOutTransition] = useTransition();
  const [isDeletingAccount, startDeleteAccountTransition] = useTransition();

  const [hoverOcid, setHoverOcid] = useState<string | null>(null);
  const [popup, setPopup] = useState<{ top: number; left: number } | null>(null);

  // 캐릭터 1개 스코프 동기화 버튼(#상세 패널 헤더)의 캐릭터별 독립 pending 상태.
  // 결과 안내(성공/실패)는 상태로 들고 있지 않고 전역 알림 모달(showNotice/showError)로 띄운다.
  const [snapshotPendingOcids, setSnapshotPendingOcids] = useState<Record<string, boolean>>({});
  const [schedulePendingOcids, setSchedulePendingOcids] = useState<Record<string, boolean>>({});

  // 캐릭터 슬라이드 "grab to scroll"(마우스 드래그로 가로 스크롤). 터치/펜은 네이티브 스크롤을 그대로 쓴다.
  const sliderRef = useRef<HTMLDivElement | null>(null);
  // pointerId 는 "지금 캡처를 걸어둔 포인터" — null 이면 캡처 없음. 캡처는 드래그로 확정된
  // 뒤에만 걸고(handleSliderPointerMove), 해제는 조건 없이 수행한다(handleSliderPointerEnd).
  const sliderDragRef = useRef<{
    dragging: boolean;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
    pointerId: number | null;
  }>({ dragging: false, startX: 0, startScrollLeft: 0, moved: false, pointerId: null });
  const [isSliderDragging, setIsSliderDragging] = useState(false);

  function bossSelectionFor(char: CharacterDTO): string[] | null {
    return Object.prototype.hasOwnProperty.call(bossSelectionMap, char.ocid)
      ? bossSelectionMap[char.ocid]
      : char.bossItemIds;
  }

  function relevantItemsFor(char: CharacterDTO): ChecklistItemDTO[] {
    const selection = bossSelectionFor(char);
    const bossSet = selection === null ? null : new Set(selection);
    // 보스 계열(주간·월간 + 일일)은 모두 캐릭터별 선택 필터를 탄다. checklist-data.ts 의
    // relevantItems 와 동일한 규칙 — 서버/클라이언트가 같은 파생 계산을 각자 수행한다.
    return items.filter((i) => !isBossCategory(i.category) || bossSet === null || bossSet.has(i.id));
  }

  function isCharComplete(char: CharacterDTO): boolean {
    const { done, total } = progressFor(char);
    return total > 0 && done >= total;
  }

  const worldCharsBase = useMemo(
    () => activeCharactersView.filter((c) => c.world === selectedWorld),
    [activeCharactersView, selectedWorld]
  );
  const worldChars = useMemo(() => {
    // 정렬 우선순위: 즐겨찾기 그룹 → (autoSort 켜졌으면) 완료 캐릭터 뒤로 → 레벨 내림차순 →
    // 안정성(동일 레벨 tie-break). 즐겨찾기가 여러 명이면 그 안에서도 레벨 내림차순으로 갈린다
    // (favorite 이 같은 값이면 아래 비교가 자연히 level 비교로 넘어가므로 별도 분기 불필요).
    return worldCharsBase
      .map((c, index) => ({ c, index, favorite: isFavoriteFor(c), complete: autoSort && isCharComplete(c) }))
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        if (a.complete !== b.complete) return a.complete ? 1 : -1;
        if (a.c.level !== b.c.level) return b.c.level - a.c.level;
        return a.index - b.index;
      })
      .map((x) => x.c);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isCharComplete/isFavoriteFor 는 doneMap/bossSelectionMap/favoriteMap 에 의존
  }, [worldCharsBase, autoSort, doneMap, bossSelectionMap, favoriteMap]);

  const [selectedOcid, setSelectedOcid] = useState<string | null>(worldChars[0]?.ocid ?? null);
  const selectedChar = useMemo(
    () => charactersView.find((c) => c.ocid === selectedOcid) ?? null,
    [charactersView, selectedOcid]
  );

  // 지금 보고 있는 월드의 활성 캐릭터를 전부 숨기면(handleSetActive) worlds 에서 그 월드
  // 자체가 빠지는데, selectedWorld 는 그 변화를 스스로 알 방법이 없어 "탭엔 없는데 헤더엔
  // 남아있는" 유령 월드 상태가 된다 — 월드 탭 어디도 하이라이트되지 않고, 헤더는 여전히
  // "OO 캐릭터 0" 을 표시하며, 슬라이더는 빈 채로 남는다(사용자가 다른 월드 탭을 눌러야만
  // handleSelectWorld 가 selectedWorld 를 고쳐줘서 복구됨). worlds 가 바뀔 때마다 selectedWorld
  // 가 여전히 그 안에 있는지 확인해, 없으면 handleSelectWorld 와 동일한 규칙(다음 유효 월드의
  // 첫 캐릭터)으로 재조정한다.
  useEffect(() => {
    if (selectedWorld !== null && worlds.includes(selectedWorld)) return;
    const nextWorld = worlds[0] ?? null;
    setSelectedWorld(nextWorld);
    const first = activeCharactersView.find((c) => c.world === nextWorld);
    setSelectedOcid(first ? first.ocid : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeCharactersView 는 매 렌더 새 배열이라 deps 에 넣으면 렌더마다 재실행된다. worlds 변화만으로 재조정 여부를 판단하기 충분하고(그 값이 활성 캐릭터의 월드 집합이다), selectedWorld 는 이 effect 가 직접 세팅하므로 deps 에 넣지 않는다(자기 자신을 트리거하는 순환을 피한다).
  }, [worlds]);

  function progressFor(char: CharacterDTO) {
    const rel = relevantItemsFor(char);
    const categories = CATEGORY_ORDER.map((cat) => {
      const catItems = rel.filter((i) => i.category === cat);
      const doneItems = catItems.filter((i) => doneMap[`${char.ocid}::${i.id}`]);
      const remainMinutes = catItems
        .filter((i) => !doneMap[`${char.ocid}::${i.id}`])
        .reduce((sum, i) => sum + (durations[i.id] ?? 0), 0);
      const totalMinutes = catItems.reduce((sum, i) => sum + (durations[i.id] ?? 0), 0);
      // "주간·월간 보스" 섹션의 12 캡은 **주간 보스에만** 적용된다 — 월간 보스(검은 마법사)는
      // 별도 월간 주기라 주간 보상 횟수에 포함되지 않는다(인게임 사양, 2026-07-30 확인).
      // 항목 자체(체크박스)는 카테고리 안에 weekly_thu/monthly 가 섞여 그대로 보이지만, 12 를
      // 분모로 하는 집계 배지의 분자는 weekly_thu 항목만 세어야 한다 — 월간 클리어를 여기
      // 섞으면 실제로 11번만 잡았는데 "12/12"로 잘못 표시될 수 있다.
      const doneCountForBadge =
        cat === "boss" ? doneItems.filter((i) => i.resetType === "weekly_thu").length : doneItems.length;

      return {
        category: cat,
        items: catItems,
        done: doneCountForBadge,
        // "주간·월간 보스" 섹션만 실제 추적 항목 수 대신 게임 실제 보상 상한(12)을 분모로
        // 고정한다(WEEKLY_BOSS_REWARD_CAP 선언부 참고). 그 결과 total 이 항목 수와 달라지므로
        // "항목이 있는지" 판정은 total 이 아니라 catItems.length(=itemCount)를 따로 써야 한다
        // — ChecklistSection 호출부에서 itemCount 를 별도로 넘기는 이유가 이것이다.
        total: cat === "boss" ? WEEKLY_BOSS_REWARD_CAP : catItems.length,
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

    runAction(() => toggleCompletion(ocid, itemId), "완료 처리 중 오류가 발생했습니다.")
      .then((result) => {
        if ("error" in result) {
          setDoneMap((m) => ({ ...m, [key]: prev }));
          showError(result.error);
        }
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
    runAction(() => saveDuration(itemId, minutes), "소요시간 저장 중 오류가 발생했습니다.").then((result) => {
      if ("error" in result) {
        setDurations((d) => ({ ...d, [itemId]: prev }));
        showError(result.error);
      }
    });
  }

  /**
   * 보스 선택 편집(#9) "완료" 콜백. 낙관적으로 선택을 갱신하고, 해제된 보스가 완료 상태였다면
   * 함께 초기화한 뒤(디자인 스펙) 서버 액션으로 커밋한다. 실패 시 둘 다 롤백.
   */
  function handleSaveBossSelection(ocid: string, selectedItemIds: string[]) {
    // bossSelectionMap 은 마운트 시 모든 캐릭터에 대해 초기화돼 있으므로(state 선언부 참고)
    // 이 시점엔 항상 해당 ocid 항목이 존재한다.
    const previousSelection = bossSelectionMap[ocid];
    const previousIds = previousSelection === null ? bossPresets.map((b) => b.id) : previousSelection;
    const nextIdSet = new Set(selectedItemIds);
    const removedIds = previousIds.filter((id) => !nextIdSet.has(id));

    const removedDoneSnapshot: Record<string, boolean> = {};
    for (const id of removedIds) {
      const key = `${ocid}::${id}`;
      removedDoneSnapshot[key] = !!doneMap[key];
    }

    setBossSelectionMap((m) => ({ ...m, [ocid]: selectedItemIds }));
    setDoneMap((m) => {
      const next = { ...m };
      for (const id of removedIds) delete next[`${ocid}::${id}`];
      return next;
    });

    runAction(() => saveBossSelection(ocid, selectedItemIds), "보스 선택 저장 중 오류가 발생했습니다.").then(
      (result) => {
        if ("error" in result) {
          setBossSelectionMap((m) => ({ ...m, [ocid]: previousSelection }));
          setDoneMap((m) => ({ ...m, ...removedDoneSnapshot }));
          showError(result.error);
        }
      }
    );
  }

  /** 카드 별 아이콘 토글. */
  function handleToggleFavorite(char: CharacterDTO) {
    const next = !isFavoriteFor(char);
    setFavoriteMap((m) => ({ ...m, [char.ocid]: next }));
    runAction(() => toggleCharacterFavorite(char.ocid, next), "즐겨찾기 설정 중 오류가 발생했습니다.").then((result) => {
      if ("error" in result) {
        setFavoriteMap((m) => ({ ...m, [char.ocid]: !next }));
        showError(result.error);
      }
    });
  }

  /**
   * 캐릭터 활성/비활성 전환. 비활성화는 상세 패널 헤더의 "숨기기" 버튼에서, 재활성화는 설정
   * 화면 "비활성 캐릭터" 목록의 "활성화" 버튼에서 호출된다. 완료 기록/보스 선택 등 기존 데이터는
   * 건드리지 않는다 — 화면 노출 여부만 바꾸는 소프트 토글이다(하드 삭제 아님).
   */
  function handleSetActive(char: CharacterDTO, active: boolean) {
    const prev = isActiveFor(char);
    // 방금 숨긴 캐릭터가 선택돼 있었다면 선택을 비운다 — 더 이상 슬라이드에 없는 캐릭터의
    // 상세 패널이 고아 상태로 화면에 남는 것을 막는다. 이 토글이 실제로 선택을 비웠는지
    // 기억해 뒀다가, 서버 액션이 실패해 activeMap 을 롤백할 때 선택도 함께 복구한다
    // (그 사이 사용자가 다른 캐릭터를 골랐다면 덮어쓰지 않도록 롤백 시점에 한 번 더 확인한다).
    const clearedSelection = !active && selectedOcid === char.ocid;
    setActiveMap((m) => ({ ...m, [char.ocid]: active }));
    if (clearedSelection) setSelectedOcid(null);

    runAction(() => setCharacterActive(char.ocid, active), "캐릭터 상태를 변경하지 못했습니다.").then((result) => {
      if ("error" in result) {
        setActiveMap((m) => ({ ...m, [char.ocid]: prev }));
        if (clearedSelection) {
          setSelectedOcid((cur) => (cur === null ? char.ocid : cur));
        }
        showError(result.error);
      }
    });
  }

  // 아래 세 핸들러는 모두 "모달 안에서 누르는 버튼"이다. 예전에는 액션이 던진 예외를 잡지
  // 않아서(트랜지션 밖으로 전파 → error.tsx) 버튼 하나 실패에 화면 전체가 에러 페이지로
  // 교체됐다. runAction/runVoidAction 으로 예외를 메시지로 바꿔 에러 모달에만 띄운다.
  function handleConfirmReset() {
    startResetTransition(async () => {
      const result = await runAction(() => resetAllCompletions(), "완료 기록 초기화 중 오류가 발생했습니다.");
      if ("error" in result) {
        showError(result.error);
        return;
      }
      setDoneMap({});
      setResetConfirmOpen(false);
      setSettingsOpen(false);
    });
  }

  function handleLogout() {
    startSignOutTransition(async () => {
      // 성공 시 signOutAction 이 redirect("/login") 하므로 이 아래로는 오지 않는다.
      const error = await runVoidAction(() => signOutAction(), "로그아웃 중 오류가 발생했습니다.");
      if (error) showError(error);
    });
  }

  function handleConfirmDeleteAccount() {
    startDeleteAccountTransition(async () => {
      const result = await runAction(() => deleteAccountAction(), "회원탈퇴 처리 중 오류가 발생했습니다.");
      if ("error" in result) {
        showError(result.error);
      }
    });
  }

  function handleSelectWorld(world: string) {
    setSelectedWorld(world);
    const first = activeCharactersView.find((c) => c.world === world);
    setSelectedOcid(first ? first.ocid : null);
    setHoverOcid(null);
    setPopup(null);
  }

  function handleSelectCharacter(ocid: string) {
    setSelectedOcid(ocid);
    setHoverOcid(null);
    setPopup(null);
  }

  /**
   * 스냅샷(이미지/전투력/포스)이 없는 캐릭터를 선택하면 그 자리에서 한 번 불러온다.
   *
   * character_cache 행은 캐릭터 목록 대조(reconcileCharacterCache) 단계에서 이름/레벨 같은
   * 가벼운 필드만으로 먼저 만들어지고, 이미지·전투력은 캐릭터별 워밍업이 나중에 채운다.
   * 그래서 워밍업이 돌지 못한 캐릭터는 행은 있는데 이미지가 비어 있는 상태로 남는다. 그런
   * 행은 "이미 캐시에 있는 캐릭터"라 상단바 "캐릭터 동기화"의 신규 목록(newOcids)에도 안 잡혀서,
   * 예전에는 캐릭터를 하나씩 골라 "동기화" 버튼을 직접 누르는 것 말고는 복구 방법이 없었다.
   *
   * ocid 당 한 번만 시도한다(ref 로 기록). 실패하거나 넥슨이 정말로 이미지를 안 주는
   * 캐릭터를 고를 때마다 넥슨을 다시 때리지 않도록.
   */
  const autoSnapshotTriedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedChar) return;
    // 이미지와 전투력이 **둘 다** 비어 있을 때만 "한 번도 안 불러온" 것으로 본다.
    if (selectedChar.imageUrl !== null || selectedChar.combatPower !== null) return;
    const ocid = selectedChar.ocid;
    if (autoSnapshotTriedRef.current.has(ocid)) return;

    // 선택이 멎은 뒤에 부른다. 캐릭터를 빠르게 훑으면 스쳐 지나간 캐릭터까지 전부 호출하게
    // 되는데, 넥슨 개발단계 키는 **초당 5건** 제한이고 캐릭터 1명 보충이 3건(basic/stat/
    // symbol 병렬)이라 1초 안에 두 명만 눌러도 한도를 넘어 429(OPENAPI00007)가 난다.
    // tried 기록도 타이머 안에서 한다 — 스쳐 지나간 캐릭터를 "시도함"으로 찍어버리면
    // 나중에 그 캐릭터를 제대로 골랐을 때 영영 보충되지 않는다.
    const timer = window.setTimeout(() => {
      autoSnapshotTriedRef.current.add(ocid);
      handleSyncSnapshot(ocid, { silent: true });
    }, AUTO_SNAPSHOT_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSyncSnapshot 은 매 렌더 새로 만들어진다(의존성에 넣으면 매번 재실행)
  }, [selectedChar]);

  /**
   * 상단바 "캐릭터 동기화". 계정 캐릭터 목록을 우리 캐시와 대조해(이름/레벨 갱신, 사라진 캐릭터
   * 삭제) 새로 생긴 캐릭터만 돌려받은 뒤, 그 캐릭터들의 상세를 1건씩 순차로 불러온다.
   */
  function handleSync() {
    if (isSyncing) return; // 연타 방지
    setIsSyncing(true);
    runAction(() => refreshCharacterList(), "캐릭터 목록을 갱신하지 못했습니다.")
      .then(async (result) => {
        if ("error" in result) {
          showError(result.error);
          return;
        }
        if (result.newOcids.length === 0) return;
        const failed = await warmUp(result.newOcids);
        if (failed > 0) {
          showError(
            `새로 추가된 캐릭터 ${failed}명의 정보를 불러오지 못했어요. 해당 캐릭터를 선택한 뒤 "동기화" 버튼으로 다시 시도해 주세요.`
          );
        }
      })
      .finally(() => {
        setIsSyncing(false);
        // 캐릭터 목록/character_cache 가 갱신됐으니 서버 컴포넌트가 최신 값을 다시 내려주게 한다.
        // 오버레이는 refresh 가 끝날 때까지 유지된다(open 조건에 isRefreshing 포함).
        startRefresh(() => router.refresh());
        endWarmup();
      });
  }

  /**
   * "동기화" 버튼(캐릭터 1개 스코프, 스탯/이미지). 성공 시 charactersView 에만 낙관적으로 반영한다.
   * silent 는 아래 자동 보충(선택 시 스냅샷 없으면 불러오기)에서 쓴다 — 사용자가 누른 게 아닌데
   * 성공 모달을 띄우면 캐릭터를 넘길 때마다 알림이 튀어나온다. 실패 모달은 남긴다(같은 캐릭터당
   * 한 번만 시도하므로 반복되지 않고, 조용히 실패하면 이미지가 왜 안 나오는지 알 수 없다).
   */
  function handleSyncSnapshot(ocid: string, options?: { silent?: boolean }) {
    if (snapshotPendingOcids[ocid]) return; // 연타 방지
    setSnapshotPendingOcids((p) => ({ ...p, [ocid]: true }));

    runAction(() => refreshCharacterSnapshot(ocid), "캐릭터 정보를 불러오지 못했습니다.")
      .then((result) => {
        if ("error" in result) {
          showError(result.error);
          return;
        }
        setCharacterOverrides((m) => ({
          ...m,
          [ocid]: {
            imageUrl: result.imageUrl,
            level: result.level,
            characterClass: result.characterClass,
            combatPower: result.combatPower,
            arcaneForce: result.arcaneForce,
            authenticForce: result.authenticForce,
          },
        }));
        if (!options?.silent) showNotice("캐릭터 정보를 최신 상태로 불러왔어요.");
      })
      .finally(() => {
        setSnapshotPendingOcids((p) => {
          const next = { ...p };
          delete next[ocid];
          return next;
        });
      });
  }

  /**
   * "숙제 동기화" 버튼(캐릭터 1개 스코프, 보스/일퀘 완료 여부 + 신규 콘텐츠 자동 등록).
   * syncedItemIds/discoveredItemIds 는 doneMap 에 낙관적으로 머지하고(둘 다 서버에서 이미
   * completions 에 반영된 항목이다), discoveredItemIds(신규 프리셋)가 있으면 클라이언트가
   * 아직 모르는 항목이 생긴 것이므로 router.refresh() 로 최신 프리셋 목록까지 받아온다.
   */
  function handleSyncSchedule(ocid: string) {
    if (schedulePendingOcids[ocid]) return; // 연타 방지
    setSchedulePendingOcids((p) => ({ ...p, [ocid]: true }));

    runAction(() => syncSchedulerState(ocid), "숙제 동기화 중 오류가 발생했습니다.")
      .then((result) => {
        if ("error" in result) {
          showError(result.error);
          return;
        }

        // syncedItemIds/discoveredItemIds 는 둘 다 "서버가 방금 완료로 기록한" 항목이다.
        // newPresetItemIds 는 완료 여부와 무관한 "새로 생긴 프리셋"이라 여기 넣으면 안 된다
        // (판정 불가 항목까지 체크된 것처럼 표시된다).
        const newlyDoneIds = [...result.syncedItemIds, ...result.discoveredItemIds];
        if (newlyDoneIds.length > 0) {
          setDoneMap((m) => {
            const next = { ...m };
            for (const id of newlyDoneIds) next[`${ocid}::${id}`] = true;
            return next;
          });
        }

        // 첫 줄은 "이번에 새로 기록한 수"가 아니라 "완료로 확인된 총 수"다 — 예전에는
        // syncedItemIds 만 셌더니 두 번째 동기화부터 항상 "0개 확인했어요" 가 떴다.
        const confirmedCount = result.syncedItemIds.length + result.alreadyDoneItemIds.length;
        const parts = [`${confirmedCount}개 항목이 완료로 확인됐어요`];
        if (result.newPresetItemIds.length > 0) {
          parts.push(`${result.newPresetItemIds.length}개 새 항목을 발견해 추가했어요`);
        }
        if (!result.hasBossData) {
          parts.push("이 캐릭터는 게임에 보스 기록이 없어 보스 항목은 확인할 수 없어요");
        } else if (!result.hasDailyData) {
          parts.push("오늘 접속 기록이 없어 일일 항목은 확인할 수 없어요");
        }
        if (result.undeterminedItemIds.length > 0) {
          // 넥슨이 "미완료"라고 한 게 아니라 판정 근거 자체를 안 주는 항목(무릉도장 등).
          // conflict 와 반드시 다른 문구여야 한다.
          parts.push(`${result.undeterminedItemIds.length}개는 게임 데이터로 완료 여부를 알 수 없어 체크를 그대로 뒀어요`);
        }
        if (result.unmatchedItemIds.length > 0) {
          parts.push("매칭 안 된 항목은 수동으로 체크해주세요");
        }
        if (result.conflictItemIds.length > 0) {
          parts.push("게임에서는 아직 미완료로 표시돼요");
        }
        showNotice(parts.join("\n"), { title: "숙제 동기화 결과" });

        // 새 프리셋이 생겼으면 클라이언트가 모르는 항목이 있으므로 목록을 다시 받아온다.
        // 완료 기록 여부(discoveredItemIds)가 아니라 프리셋 생성 여부로 판단해야 한다 —
        // 판정 불가로 생성만 된 항목은 discoveredItemIds 에 없어서 예전 조건으로는 화면에
        // 영영 나타나지 않았다.
        if (result.newPresetItemIds.length > 0) {
          startRefresh(() => router.refresh());
        }
      })
      .finally(() => {
        setSchedulePendingOcids((p) => {
          const next = { ...p };
          delete next[ocid];
          return next;
        });
      });
  }

  function handleGoHome() {
    setSelectedWorld(worlds[0] ?? null);
    const first = activeCharactersView.find((c) => c.world === (worlds[0] ?? null));
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
  }

  function handleHoverLeave(ocid: string) {
    setHoverOcid((cur) => (cur === ocid ? null : cur));
    setPopup((p) => (hoverOcid === ocid ? null : p));
  }

  function handleSliderPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const el = sliderRef.current;
    if (!el) return;
    // ⚠️ 여기서 setPointerCapture 를 부르면 안 된다.
    //
    // 포인터 캡처가 걸린 상태에서는 호환 마우스 이벤트(mouseup)까지 캡처 대상(=슬라이더)으로
    // 리타겟팅된다. 그러면 브라우저는 click 을 "mousedown 타깃과 mouseup 타깃의 공통 조상"
    // 인 슬라이더에 발생시키고, 카드의 onClick 은 이벤트 경로에 아예 들어오지 않아 캐릭터
    // 선택이 죽는다(클릭은 정상 전파되고 preventDefault 도 안 걸려 있어 원인 추적이 어렵다).
    //
    // 게다가 이 함수와 짝인 handleSliderPointerEnd 는 onPointerUp/Cancel/**Leave** 세 곳에
    // 걸려 있어서, pointerleave 가 먼저 돌아 dragging 이 false 가 되면 뒤이은 pointerup 이
    // early return 되며 캡처가 **영구히 남았다**. 그때부터 새로고침 전까지 모든 카드 클릭이
    // 먹지 않았다. 캡처는 아래 pointermove 에서 "진짜 드래그"로 판명된 뒤에만 건다.
    sliderDragRef.current = {
      dragging: true,
      startX: event.clientX,
      startScrollLeft: el.scrollLeft,
      moved: false,
      pointerId: null,
    };
    setIsSliderDragging(true);
    // 드래그 시작 즉시 호버 팝업을 닫는다(드래그 중 카드 위를 스쳐도 팝업이 깜빡이지 않도록).
    setHoverOcid(null);
    setPopup(null);
  }

  function handleSliderPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    const drag = sliderDragRef.current;
    if (!drag.dragging || event.buttons !== 1) return;
    const el = sliderRef.current;
    if (!el) return;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 6) {
      drag.moved = true;
      // 임계값을 넘긴 시점 = 클릭이 아니라 드래그로 확정된 시점. 이제서야 캡처를 건다.
      // (이 클릭은 어차피 handleSliderClickCapture 가 moved 를 보고 무효화하므로,
      //  캡처로 인한 리타겟팅이 선택을 망가뜨리지 않는다.)
      if (drag.pointerId === null) {
        el.setPointerCapture(event.pointerId);
        drag.pointerId = event.pointerId;
      }
    }
    el.scrollLeft = drag.startScrollLeft - delta;
  }

  function handleSliderPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    const drag = sliderDragRef.current;
    const el = sliderRef.current;

    // 캡처 해제는 dragging 여부와 **무관하게** 가장 먼저 한다. 이 함수는 pointerup/cancel/leave
    // 세 경로로 들어오는데, 먼저 들어온 호출이 dragging 을 내려버리면 나중 호출이 early return
    // 되어 캡처가 남는다 — 그 상태가 위에서 설명한 "카드 클릭이 통째로 죽는" 원인이었다.
    if (drag.pointerId !== null) {
      if (el?.hasPointerCapture(drag.pointerId)) el.releasePointerCapture(drag.pointerId);
      drag.pointerId = null;
    }

    if (!drag.dragging) return;
    const wasMoved = drag.moved;
    drag.dragging = false;
    setIsSliderDragging(false);

    // 실제로 스크롤이 일어난 드래그였다면(1:1 스크롤 보정 때문에) 커서는 대개 드래그 시작 때와
    // 같은 카드 위에 남아 있어 mouseenter 가 재발생하지 않는다. 포인터 아래 카드를 직접 찾아
    // 호버 팝업을 수동으로 갱신한다.
    if (wasMoved) {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const cardEl = target instanceof Element ? target.closest<HTMLElement>("[data-ocid]") : null;
      const ocid = cardEl?.dataset.ocid;
      if (ocid && cardEl) {
        handleHoverEnter(ocid, cardEl.getBoundingClientRect());
      }
    }
  }

  // 드래그로 끝난 포인터업이 카드 버튼의 click 으로 이어지지 않도록 캡처 단계에서 무효화한다.
  function handleSliderClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (sliderDragRef.current.moved) {
      event.preventDefault();
      event.stopPropagation();
      sliderDragRef.current.moved = false;
    }
  }

  const hoverChar = hoverOcid ? charactersView.find((c) => c.ocid === hoverOcid) ?? null : null;
  const hoverProgress = hoverChar ? progressFor(hoverChar) : null;

  const bossEditChar = bossEditOcid ? charactersView.find((c) => c.ocid === bossEditOcid) ?? null : null;

  return (
    <div className="relative z-10">
      {/* 신규 캐릭터를 순차로 불러오는 동안 화면 전체를 덮는다. 다 불러온 뒤 화면이 갱신된다.
          (여기는 최초 연결과 달리 이미 캐릭터 목록이 떠 있는 화면이라, refresh 까지 오버레이를
          붙들어 둘 필요는 없다 — NexonKeyCard 쪽만 isRefreshing 을 open 조건에 포함한다.) */}
      <ProgressOverlay
        open={warmupProgress !== null}
        title="API 호출중입니다"
        description="새로 추가된 캐릭터 정보를 불러오고 있어요."
        done={warmupProgress?.done ?? 0}
        total={warmupProgress?.total ?? 0}
      />

      <div className="sticky top-0 z-[100] border-b border-maple-line-subtle bg-white/[.86] backdrop-blur-[10px]">
        <div className="mx-auto flex max-w-[1080px] items-center gap-2.5 px-5 py-[11px]">
          <button type="button" onClick={handleGoHome} aria-label="홈" className="flex items-center">
            <Logo size="sm" />
          </button>
          <span className="flex-1" />
          <IconButton ariaLabel="캐릭터 동기화" onClick={handleSync}>
            <RefreshCw className={cn("h-[18px] w-[18px]", isSyncing && "animate-maple-spin")} aria-hidden="true" />
          </IconButton>
          {isAdmin && (
            <IconButton ariaLabel="관리자 페이지" onClick={() => router.push("/admin")}>
              <Shield className="h-[18px] w-[18px]" aria-hidden="true" />
            </IconButton>
          )}
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
          ) : activeCharactersView.length === 0 ? (
            // 캐릭터는 있지만 전부 숨김 처리된 상태 — worlds/selectedWorld 가 비어 "null 캐릭터"
            // 같은 값이 그대로 보이는 것을 막고, 설정으로 안내한다.
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-maple-line bg-maple-surface-raised px-6 py-12 text-center">
              <p className="text-sm font-semibold text-maple-text-secondary">모든 캐릭터가 숨겨져 있어요.</p>
              <p className="max-w-[36ch] text-xs text-maple-text-muted">
                설정의 &ldquo;비활성 캐릭터&rdquo;에서 다시 활성화할 수 있어요.
              </p>
              <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
                설정 열기
              </Button>
            </div>
          ) : (
            <>
              <div>
                <div className="mb-2.5 text-xs font-extrabold tracking-[.04em] text-maple-text-muted">월드</div>
                <div className="flex flex-wrap gap-2">
                  {worlds.map((world) => {
                    const count = activeCharactersView.filter((c) => c.world === world).length;
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
                <div
                  ref={sliderRef}
                  className={cn(
                    "flex select-none gap-3 overflow-x-auto px-0.5 pb-3 pt-0.5",
                    isSliderDragging ? "cursor-grabbing" : "cursor-grab"
                  )}
                  style={{ scrollSnapType: isSliderDragging ? "none" : "x proximity" }}
                  onPointerDown={handleSliderPointerDown}
                  onPointerMove={handleSliderPointerMove}
                  onPointerUp={handleSliderPointerEnd}
                  onPointerCancel={handleSliderPointerEnd}
                  onPointerLeave={handleSliderPointerEnd}
                  onClickCapture={handleSliderClickCapture}
                  onDragStart={(event) => event.preventDefault()}
                >
                  {worldChars.map((char) => {
                    const progress = progressFor(char);
                    const complete = progress.total > 0 && progress.done >= progress.total;
                    const selected = char.ocid === selectedOcid;
                    const favorite = isFavoriteFor(char);
                    return (
                      <div
                        key={char.ocid}
                        data-ocid={char.ocid}
                        // 카드 **전체**가 선택 영역이다. 예전에는 아래 이름/진행률 버튼에만 onClick 이
                        // 걸려 있어서, 카드 면적의 절반이 넘는 이미지 영역을 눌러도 아무 일이 없었다
                        // (대부분의 사용자가 그림을 누른다). 안쪽 버튼은 클릭이 여기로 버블링되므로
                        // 자체 onClick 없이 키보드 포커스 대상 역할만 한다 — 핸들러가 두 번 불리지 않는다.
                        onClick={() => handleSelectCharacter(char.ocid)}
                        onMouseEnter={(event) => {
                          if (sliderDragRef.current.dragging) return;
                          handleHoverEnter(char.ocid, event.currentTarget.getBoundingClientRect());
                        }}
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
                              draggable={false}
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs font-semibold text-maple-text-muted">
                              이미지 없음
                            </div>
                          )}
                          <span className="pointer-events-none absolute bottom-2 left-2 rounded-[7px] border border-[#ffe0c2] bg-white/[.92] px-[7px] py-[2px] text-[10.5px] font-extrabold tabular-nums text-maple-orange-300">
                            Lv.{char.level}
                          </span>
                          {/* 별 버튼은 카드 onClick(선택)과 별개의 독립된 액션이라 stopPropagation
                              한다 — 안 하면 즐겨찾기 토글이 선택 변경과 함께 일어나 버블링을 타고
                              handleSelectCharacter 도 호출된다(해로울 건 없지만 의도를 흐린다). */}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleToggleFavorite(char);
                            }}
                            aria-label={favorite ? `${char.name} 즐겨찾기 해제` : `${char.name} 즐겨찾기 추가`}
                            aria-pressed={favorite}
                            className={cn(
                              "absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border transition-colors duration-180",
                              favorite
                                ? "border-maple-orange bg-maple-orange text-white shadow-glow-orange"
                                : "border-maple-line bg-white/[.92] text-maple-text-muted hover:text-maple-orange"
                            )}
                          >
                            <Star
                              className="h-3.5 w-3.5"
                              strokeWidth={2.4}
                              fill={favorite ? "currentColor" : "none"}
                              aria-hidden="true"
                            />
                          </button>
                          {complete && (
                            <span className="pointer-events-none absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-maple-success text-white shadow-glow-success">
                              <Check className="h-3.5 w-3.5" strokeWidth={3.2} aria-hidden="true" />
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          aria-label={`${char.name} 선택`}
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
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-extrabold text-maple-text-primary">
                        {selectedChar.name}
                      </div>
                      <div className="mt-0.5 truncate text-[11.5px] tabular-nums text-maple-text-muted">
                        Lv.{selectedChar.level} · {selectedChar.characterClass}
                      </div>
                    </div>
                    <div className="flex flex-none gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        pending={!!snapshotPendingOcids[selectedChar.ocid]}
                        onClick={() => handleSyncSnapshot(selectedChar.ocid)}
                      >
                        동기화
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        pending={!!schedulePendingOcids[selectedChar.ocid]}
                        onClick={() => handleSyncSchedule(selectedChar.ocid)}
                      >
                        숙제 동기화
                      </Button>
                      {/* 재활성화는 설정 화면의 "비활성 캐릭터" 목록에서만 한다 — 여기 버튼은
                          숨기기(비활성화) 전용이라 selectedChar 가 항상 활성 캐릭터라는 전제가
                          안전하다(비활성 캐릭터는애초에 슬라이드/선택 대상에서 빠지므로). */}
                      <IconButton
                        ariaLabel={`${selectedChar.name} 숨기기`}
                        onClick={() => handleSetActive(selectedChar, false)}
                      >
                        <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" />
                      </IconButton>
                    </div>
                  </div>

                  {progressFor(selectedChar).categories.map((cat) => {
                    const visibleItems = hideDone
                      ? cat.items.filter((item) => !doneMap[`${selectedChar.ocid}::${item.id}`])
                      : cat.items;
                    return (
                      <ChecklistSection
                        key={cat.category}
                        category={cat.category}
                        done={cat.done}
                        total={cat.total}
                        itemCount={cat.items.length}
                        collapsed={!!collapsedCategories[cat.category]}
                        onToggleCollapsed={() => toggleCategoryCollapsed(cat.category)}
                        remainLabel={formatMinutes(cat.remainMinutes)}
                        totalLabel={formatMinutes(cat.totalMinutes)}
                        onBulkComplete={() => handleBulkComplete(selectedChar, cat.category)}
                        extraContent={
                          // 보스 편집 다이얼로그는 일일/주간/월간 보스를 한 번에 다루므로 두
                          // 보스 섹션 어디서든 열 수 있게 한다(일일 보스 섹션만 보고 있는 사용자가
                          // 편집 진입점을 못 찾는 일이 없도록).
                          isBossCategory(cat.category) ? (
                            <div className="px-1 pb-2.5">
                              <button
                                type="button"
                                onClick={() => setBossEditOcid(selectedChar.ocid)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-maple-line bg-maple-surface-inset px-2.5 py-1.5 text-[11.5px] font-extrabold text-maple-text-secondary transition-colors hover:bg-maple-surface-sunken"
                              >
                                <ListChecks className="h-[13px] w-[13px]" aria-hidden="true" />
                                이 캐릭터가 잡는 보스 편집
                              </button>
                            </div>
                          ) : undefined
                        }
                      >
                        {cat.total > 0 && visibleItems.length === 0 ? (
                          <p className="px-1 py-3 text-xs font-semibold text-maple-success-text">
                            완료한 숙제만 있어요. 설정에서 &ldquo;완료 항목 숨기기&rdquo;를 꺼서 다시 볼 수 있어요.
                          </p>
                        ) : (
                          visibleItems.map((item) => {
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
                          })
                        )}
                      </ChecklistSection>
                    );
                  })}
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
                value={hoverChar.combatPower != null ? hoverChar.combatPower.toLocaleString() : "—"}
              />
              {/* TODO: 헥사 스탯 — 연동된 넥슨 엔드포인트가 없어 생략(헥사 매트릭스 API 확보 시 추가) */}
              <StatChip label="헥사 스탯" value="—" />
              <StatChip
                label="아케인 포스"
                value={hoverChar.arcaneForce != null ? hoverChar.arcaneForce.toLocaleString() : "—"}
              />
              <StatChip
                label="어센틱 포스"
                value={hoverChar.authenticForce != null ? hoverChar.authenticForce.toLocaleString() : "—"}
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

          <div className="rounded-2xl border border-maple-line bg-maple-surface-card p-4">
            <h3 className="text-sm font-extrabold text-maple-text-primary">표시 설정</h3>
            <div className="mt-3 flex flex-col">
              <div className="flex items-center gap-3.5 py-1">
                <div className="flex-1">
                  <div className="text-sm font-semibold text-maple-text-primary">완료 항목 숨기기</div>
                  <div className="mt-0.5 text-[11.5px] text-maple-text-muted">완료한 숙제를 목록에서 가립니다.</div>
                </div>
                <Switch checked={hideDone} onChange={setHideDone} ariaLabel="완료 항목 숨기기" />
              </div>
              <div className="h-px bg-maple-line-subtle" />
              <div className="flex items-center gap-3.5 py-1">
                <div className="flex-1">
                  <div className="text-sm font-semibold text-maple-text-primary">완료 캐릭터 뒤로 정렬</div>
                  <div className="mt-0.5 text-[11.5px] text-maple-text-muted">숙제를 끝낸 캐릭터를 슬라이더 뒤로 보냅니다.</div>
                </div>
                <Switch checked={autoSort} onChange={setAutoSort} ariaLabel="완료 캐릭터 뒤로 정렬" />
              </div>
            </div>
          </div>

          {/* 즐겨찾기/숨김이 하나도 없는 대다수 사용자에게는 안 보이는 섹션 — 숨긴 캐릭터가
              있을 때만 렌더한다(빈 섹션으로 설정 화면을 채우지 않는다). */}
          {inactiveCharacters.length > 0 && (
            <div className="rounded-2xl border border-maple-line bg-maple-surface-card p-4">
              <h3 className="text-sm font-extrabold text-maple-text-primary">비활성 캐릭터</h3>
              <p className="mt-1 text-[11.5px] text-maple-text-muted">
                메인 화면 슬라이드에서 숨긴 캐릭터예요. 다시 활성화하면 슬라이드로 돌아와요.
              </p>
              <div className="mt-3 flex flex-col divide-y divide-maple-line-subtle">
                {inactiveCharacters.map((c) => (
                  <div key={c.ocid} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-maple-text-primary">{c.name}</div>
                      <div className="truncate text-[11px] text-maple-text-muted">
                        {c.world} · Lv.{c.level}
                      </div>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => handleSetActive(c, true)}>
                      활성화
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-maple-line bg-maple-surface-card p-4">
            <h3 className="text-sm font-extrabold text-maple-text-primary">완료 기록 초기화</h3>
            <div className="mt-3 flex items-center gap-3">
              <p className="flex-1 text-xs leading-relaxed text-maple-text-muted">
                모든 캐릭터의 이번 주기 완료 기록을 지웁니다.
              </p>
              <Button variant="danger" size="sm" onClick={() => setResetConfirmOpen(true)}>
                초기화
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-maple-line bg-maple-surface-card p-4">
            <h3 className="text-sm font-extrabold text-maple-text-primary">계정</h3>
            <div className="mt-3 flex flex-col">
              <div className="flex items-center gap-3 py-1">
                <p className="flex-1 text-xs leading-relaxed text-maple-text-muted">이 기기에서 로그아웃합니다.</p>
                <Button variant="secondary" size="sm" pending={isSigningOut} onClick={handleLogout}>
                  로그아웃
                </Button>
              </div>
              <div className="h-px bg-maple-line-subtle" />
              <div className="flex items-center gap-3 py-1 pt-2.5">
                <p className="flex-1 text-xs leading-relaxed text-maple-text-muted">
                  계정과 등록된 API 키, 캐릭터 기록을 모두 삭제합니다.
                </p>
                <Button variant="danger" size="sm" onClick={() => setDeleteAccountConfirmOpen(true)}>
                  회원탈퇴
                </Button>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setSettingsOpen(false)}>
              닫기
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={resetConfirmOpen}
        title="완료 기록을 초기화할까요?"
        description="현재 주기의 모든 완료 체크가 사라집니다. 이 작업은 되돌릴 수 없습니다."
        onClose={() => setResetConfirmOpen(false)}
        widthClassName="max-w-[420px]"
      >
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={() => setResetConfirmOpen(false)}>
            취소
          </Button>
          <Button variant="danger" pending={isResetting} onClick={handleConfirmReset}>
            초기화
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={deleteAccountConfirmOpen}
        title="정말 탈퇴하시겠어요?"
        description="계정, 등록된 API 키, 모든 캐릭터의 숙제 기록이 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다."
        onClose={() => setDeleteAccountConfirmOpen(false)}
        widthClassName="max-w-[420px]"
      >
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={() => setDeleteAccountConfirmOpen(false)}>
            취소
          </Button>
          <Button variant="danger" pending={isDeletingAccount} onClick={handleConfirmDeleteAccount}>
            탈퇴
          </Button>
        </div>
      </Dialog>

      <BossEditDialog
        open={bossEditOcid !== null}
        character={
          bossEditChar
            ? {
                ocid: bossEditChar.ocid,
                name: bossEditChar.name,
                level: bossEditChar.level,
                arcaneForce: bossEditChar.arcaneForce,
                authenticForce: bossEditChar.authenticForce,
              }
            : null
        }
        bossPresets={bossPresets}
        initialSelected={bossEditChar ? bossSelectionFor(bossEditChar) : null}
        onClose={() => setBossEditOcid(null)}
        onSave={handleSaveBossSelection}
      />
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
