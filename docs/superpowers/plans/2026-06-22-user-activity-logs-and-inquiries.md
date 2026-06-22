# 사용자 활동 로그 & 1:1 문의 시스템 — 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 일반 사용자의 검색 활동을 관리자가 회원별로 조회하고, 사용자–관리자 1:1 문의 스레드(실시간 알림 포함)를 주고받게 한다.

**Architecture:** Supabase에 `search_logs`·`inquiries` 두 테이블(+RLS+Realtime)을 추가하고, 검색 시작/종료 시 요약 1행을 기록한다. 일반 사용자는 상세로그를 숨기고 실패 시 문의 유도 모달을 띄운다. 관리자는 회원 더블클릭으로 검색내역·문의 스레드를 보고 답변하며, Realtime으로 새 문의 배지를 받는다.

**Tech Stack:** Vite + React + TypeScript (Vercel), Supabase JS v2 (auth/postgrest/realtime), 기존 `is_admin()` RLS 패턴.

**테스트 정책:** 이 저장소엔 테스트 러너가 없다(`package.json` scripts = dev/build/preview/typecheck). 따라서 각 태스크 검증은 **`npm run typecheck`** + **`npm run build`** + **로컬 dev 서버 수동 확인**으로 한다. 새 테스트 프레임워크는 도입하지 않는다(스코프 외).

**공통 규칙:**
- 커밋 메시지: `feat:`/`fix:`/`docs:` 형식. 첨부 라인 없음(전역 설정).
- 모든 신규 repo는 `supabase` 미설정 시 안전 no-op(기존 `slotsRepo`/`profilesRepo` 패턴).
- camelCase 도메인 타입 ↔ snake_case row 매핑은 `toX()` 헬퍼로(기존 `profilesRepo` 패턴).

---

## Task 1: DB 스키마 — `search_logs` + `inquiries` (+RLS+Realtime+정리함수)

**Files:**
- Modify: `supabase/schema.sql` (파일 끝에 추가)

- [ ] **Step 1: `supabase/schema.sql` 끝에 아래 SQL을 추가**

```sql

-- ============================================================
-- 검색 활동 로그 (검색 1회 = 1행, 결과 매물 제외 / 보존 6개월)
-- ============================================================
create table if not exists public.search_logs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade default auth.uid(),
  large_name       text,
  mid_name         text,
  small_name       text,
  real_estate_type text not null,
  trade_type       text,
  area_label       text,
  status           text not null default 'running'
                     check (status in ('running','done','error','stopped')),
  result_count     int,
  error_message    text,
  created_at       timestamptz not null default now(),
  ended_at         timestamptz
);
create index if not exists idx_search_logs_user_created
  on public.search_logs (user_id, created_at desc);

alter table public.search_logs enable row level security;

drop policy if exists "search_logs_insert_own" on public.search_logs;
create policy "search_logs_insert_own" on public.search_logs
  for insert with check (user_id = auth.uid());

drop policy if exists "search_logs_update_own" on public.search_logs;
create policy "search_logs_update_own" on public.search_logs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "search_logs_select_own_or_admin" on public.search_logs;
create policy "search_logs_select_own_or_admin" on public.search_logs
  for select using (user_id = auth.uid() or public.is_admin());

-- 6개월 초과 로그 정리 함수 (pg_cron 가능 시 스케줄 등록)
create or replace function public.cleanup_old_search_logs()
returns void language sql security definer set search_path = public as $$
  delete from public.search_logs where created_at < now() - interval '6 months';
$$;
-- pg_cron 사용 가능 환경에서만 (Supabase Dashboard → Database → Extensions 에서 pg_cron 활성화 후):
-- select cron.schedule('cleanup_search_logs', '0 3 * * *', $$select public.cleanup_old_search_logs()$$);

-- ============================================================
-- 1:1 문의 (1행 = 스레드 메시지 1개, 사용자당 1스레드 = user_id)
-- ============================================================
create table if not exists public.inquiries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  sender_role   text not null check (sender_role in ('user','admin')),
  body          text not null,
  context       jsonb,
  read_by_admin boolean not null default false,
  read_by_user  boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists idx_inquiries_user_created
  on public.inquiries (user_id, created_at);

alter table public.inquiries enable row level security;

drop policy if exists "inquiries_select_own_or_admin" on public.inquiries;
create policy "inquiries_select_own_or_admin" on public.inquiries
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "inquiries_insert_scoped" on public.inquiries;
create policy "inquiries_insert_scoped" on public.inquiries
  for insert with check (
    (user_id = auth.uid() and sender_role = 'user')
    or (public.is_admin() and sender_role = 'admin')
  );

drop policy if exists "inquiries_update_visible" on public.inquiries;
create policy "inquiries_update_visible" on public.inquiries
  for update using (user_id = auth.uid() or public.is_admin())
              with check (user_id = auth.uid() or public.is_admin());

-- Realtime 발행 (이미 추가돼 있으면 에러 무시)
do $$
begin
  alter publication supabase_realtime add table public.inquiries;
exception when duplicate_object then null;
end $$;
```

- [ ] **Step 2: Supabase에 적용**

Supabase Dashboard → SQL Editor 에 위에서 추가한 블록을 붙여넣고 실행. 에러 없이 완료되는지 확인.
(주의: `cron.schedule` 줄은 pg_cron 확장이 켜진 경우에만 실행. 안 켜져 있으면 그 한 줄은 건너뛴다. 읽기 측 6개월 필터만으로도 요구사항 충족.)

- [ ] **Step 3: 적용 검증 (SQL Editor)**

```sql
select tablename from pg_tables where schemaname='public' and tablename in ('search_logs','inquiries');
-- 2행 반환 기대
select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='inquiries';
-- 1행 반환 기대
```

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: search_logs/inquiries 테이블 + RLS + Realtime 스키마 추가"
```

---

## Task 2: `searchLogsRepo` 서비스

**Files:**
- Create: `src/services/searchLogsRepo.ts`

- [ ] **Step 1: `src/services/searchLogsRepo.ts` 생성**

```ts
import { supabase } from './supabase';
import type { SearchMeta } from '../types';

// 검색 요약 로그 (결과 매물 제외). status 는 검색 진행 상태.
export type SearchLogStatus = 'running' | 'done' | 'error' | 'stopped';

export interface SearchLog {
  id: string;
  userId: string;
  largeName: string | null;
  midName: string | null;
  smallName: string | null;
  realEstateType: string;
  tradeType: string | null;
  areaLabel: string | null;
  status: SearchLogStatus;
  resultCount: number | null;
  errorMessage: string | null;
  createdAt: string;
  endedAt: string | null;
}

interface SearchLogRow {
  id: string;
  user_id: string;
  large_name: string | null;
  mid_name: string | null;
  small_name: string | null;
  real_estate_type: string;
  trade_type: string | null;
  area_label: string | null;
  status: SearchLogStatus;
  result_count: number | null;
  error_message: string | null;
  created_at: string;
  ended_at: string | null;
}

const COLS =
  'id, user_id, large_name, mid_name, small_name, real_estate_type, trade_type, area_label, status, result_count, error_message, created_at, ended_at';

function toSearchLog(r: SearchLogRow): SearchLog {
  return {
    id: r.id,
    userId: r.user_id,
    largeName: r.large_name,
    midName: r.mid_name,
    smallName: r.small_name,
    realEstateType: r.real_estate_type,
    tradeType: r.trade_type,
    areaLabel: r.area_label,
    status: r.status,
    resultCount: r.result_count,
    errorMessage: r.error_message,
    createdAt: r.created_at,
    endedAt: r.ended_at,
  };
}

// 검색 시작 시 'running' 행 삽입 → 생성된 id 반환. 실패/비로그인 시 null(검색은 계속 진행).
export async function startSearchLog(meta: SearchMeta): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return null;
    const { data, error } = await supabase
      .from('search_logs')
      .insert({
        user_id: uid,
        large_name: meta.largeName || null,
        mid_name: meta.midName || null,
        small_name: meta.smallName || null,
        real_estate_type: meta.realEstateType,
        trade_type: meta.tradeType || null,
        area_label: meta.areaLabel || null,
        status: 'running',
      })
      .select('id')
      .single();
    if (error) {
      console.warn('검색 로그 시작 기록 실패:', error.message);
      return null;
    }
    return (data as { id: string }).id;
  } catch (err) {
    console.warn('검색 로그 시작 기록 예외:', err);
    return null;
  }
}

// 검색 종료 시 같은 행을 종료 상태로 갱신. id 없으면(=시작 기록 실패) no-op.
export async function finishSearchLog(
  id: string | null,
  patch: { status: SearchLogStatus; resultCount?: number; errorMessage?: string },
): Promise<void> {
  if (!supabase || !id) return;
  try {
    const { error } = await supabase
      .from('search_logs')
      .update({
        status: patch.status,
        result_count: patch.resultCount ?? null,
        error_message: patch.errorMessage ?? null,
        ended_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) console.warn('검색 로그 종료 기록 실패:', error.message);
  } catch (err) {
    console.warn('검색 로그 종료 기록 예외:', err);
  }
}

// 관리자: 특정 사용자의 최근 6개월 검색내역 (최신순).
export async function listSearchLogs(userId: string): Promise<SearchLog[]> {
  if (!supabase) return [];
  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const { data, error } = await supabase
    .from('search_logs')
    .select(COLS)
    .eq('user_id', userId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data as SearchLogRow[] | null) ?? []).map(toSearchLog);
}
```

- [ ] **Step 2: 타입체크**

Run: `npm run typecheck`
Expected: 에러 없음 (SearchMeta 는 `src/types/index.ts`에 이미 존재).

- [ ] **Step 3: Commit**

```bash
git add src/services/searchLogsRepo.ts
git commit -m "feat: searchLogsRepo (검색 요약 로그 기록/조회)"
```

---

## Task 3: `inquiriesRepo` 서비스

**Files:**
- Create: `src/services/inquiriesRepo.ts`

- [ ] **Step 1: `src/services/inquiriesRepo.ts` 생성**

```ts
import { supabase } from './supabase';

export type InquirySenderRole = 'user' | 'admin';

export interface InquiryMessage {
  id: string;
  userId: string;
  senderRole: InquirySenderRole;
  body: string;
  context: Record<string, unknown> | null;
  readByAdmin: boolean;
  readByUser: boolean;
  createdAt: string;
}

interface InquiryRow {
  id: string;
  user_id: string;
  sender_role: InquirySenderRole;
  body: string;
  context: Record<string, unknown> | null;
  read_by_admin: boolean;
  read_by_user: boolean;
  created_at: string;
}

const COLS = 'id, user_id, sender_role, body, context, read_by_admin, read_by_user, created_at';

function toMsg(r: InquiryRow): InquiryMessage {
  return {
    id: r.id,
    userId: r.user_id,
    senderRole: r.sender_role,
    body: r.body,
    context: r.context,
    readByAdmin: r.read_by_admin,
    readByUser: r.read_by_user,
    createdAt: r.created_at,
  };
}

async function currentUid(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// ── 사용자(본인) ──────────────────────────────────────────────
export async function listMyThread(): Promise<InquiryMessage[]> {
  if (!supabase) return [];
  const uid = await currentUid();
  if (!uid) return [];
  const { data, error } = await supabase
    .from('inquiries')
    .select(COLS)
    .eq('user_id', uid)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return ((data as InquiryRow[] | null) ?? []).map(toMsg);
}

export async function sendUserMessage(
  body: string,
  context?: Record<string, unknown>,
): Promise<void> {
  if (!supabase) return;
  const uid = await currentUid();
  if (!uid) throw new Error('로그인이 필요합니다.');
  const { error } = await supabase.from('inquiries').insert({
    user_id: uid,
    sender_role: 'user',
    body,
    context: context ?? null,
    read_by_user: true,
    read_by_admin: false,
  });
  if (error) throw error;
}

// 관리자 답변을 읽음 처리 (본인 스레드의 admin 메시지)
export async function markThreadReadByUser(): Promise<void> {
  if (!supabase) return;
  const uid = await currentUid();
  if (!uid) return;
  const { error } = await supabase
    .from('inquiries')
    .update({ read_by_user: true })
    .eq('user_id', uid)
    .eq('sender_role', 'admin')
    .eq('read_by_user', false);
  if (error) console.warn('문의 읽음 처리 실패(user):', error.message);
}

export async function countUserUnread(): Promise<number> {
  if (!supabase) return 0;
  const uid = await currentUid();
  if (!uid) return 0;
  const { count, error } = await supabase
    .from('inquiries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid)
    .eq('sender_role', 'admin')
    .eq('read_by_user', false);
  if (error) return 0;
  return count ?? 0;
}

// ── 관리자 ────────────────────────────────────────────────────
export async function listThread(userId: string): Promise<InquiryMessage[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('inquiries')
    .select(COLS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return ((data as InquiryRow[] | null) ?? []).map(toMsg);
}

export async function sendAdminReply(userId: string, body: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('inquiries').insert({
    user_id: userId,
    sender_role: 'admin',
    body,
    read_by_admin: true,
    read_by_user: false,
  });
  if (error) throw error;
}

export async function markThreadReadByAdmin(userId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('inquiries')
    .update({ read_by_admin: true })
    .eq('user_id', userId)
    .eq('sender_role', 'user')
    .eq('read_by_admin', false);
  if (error) console.warn('문의 읽음 처리 실패(admin):', error.message);
}

export async function countAdminUnread(): Promise<number> {
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from('inquiries')
    .select('id', { count: 'exact', head: true })
    .eq('sender_role', 'user')
    .eq('read_by_admin', false);
  if (error) return 0;
  return count ?? 0;
}

// 미읽음 user 메시지를 가진 사용자 id 집합 (회원 행 dot 표시용)
export async function listUnreadUserIds(): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('inquiries')
    .select('user_id')
    .eq('sender_role', 'user')
    .eq('read_by_admin', false);
  if (error) return [];
  const ids = ((data as { user_id: string }[] | null) ?? []).map((r) => r.user_id);
  return Array.from(new Set(ids));
}
```

- [ ] **Step 2: 타입체크**

Run: `npm run typecheck`
Expected: 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src/services/inquiriesRepo.ts
git commit -m "feat: inquiriesRepo (1:1 문의 스레드 CRUD + 미읽음 카운트)"
```

---

## Task 4: 검색 로깅 + 상세로그 역할 게이팅

**Files:**
- Modify: `src/App.tsx` (NaverCrawlerTab 에 `isAdmin` 전달)
- Modify: `src/components/NaverCrawlerTab.tsx` (props 추가, 검색 로깅 effect, CrawlModal 에 isAdmin 전달)
- Modify: `src/components/CrawlModal.tsx` (isAdmin prop 추가 → CrawlProgressPanel 전달)
- Modify: `src/components/CrawlProgressPanel.tsx` (isAdmin prop → 상세로그 섹션 조건부)

- [ ] **Step 1: `CrawlProgressPanel.tsx` — isAdmin prop 추가 + 상세로그 게이팅**

`CrawlProgressPanelProps` 인터페이스(파일 5-12행)에 `isAdmin` 추가:

```ts
interface CrawlProgressPanelProps {
  dongs: DongProgress[];
  logs: LogEntry[];
  status: CrawlerStatus;
  regionName: string;
  isAdmin: boolean;
  onClearLogs: () => void;
  onSkipDong: (index: number) => void;
}
```

함수 시그니처(27-29행) 구조분해에 `isAdmin` 추가:

```ts
export function CrawlProgressPanel({
  dongs, logs, status, regionName, isAdmin, onClearLogs, onSkipDong,
}: CrawlProgressPanelProps) {
```

상세로그 래퍼 전체(141행 `<div className="cp-log-wrap">` ~ 178행 닫는 `</div>`)를 `isAdmin` 조건으로 감싼다:

```tsx
      {isAdmin && (
        <div className="cp-log-wrap">
          {logOpen && (
            <div className="cp-resizer" onMouseDown={startResize} title="드래그하여 로그 영역 크기 조절">
              <span className="cp-resizer-grip" />
            </div>
          )}
          <button className="cp-log-toggle" onClick={() => setLogOpen((v) => !v)}>
            <svg className={`caret${logOpen ? ' open' : ''}`} viewBox="0 0 24 24">
              <path d="M6 9l6 6 6-6" />
            </svg>
            상세 로그
            <span className="cp-log-count">{logs.length > 0 ? logs.length : ''}</span>
          </button>

          {logOpen && (
            <>
              <div className="cp-log-body" ref={logRef} style={{ height: logHeight }}>
                {logs.length === 0 ? (
                  <div className="cp-log-empty">로그가 없습니다</div>
                ) : (
                  logs.map((entry, i) => (
                    <div key={i} className={`cp-log-entry log-${entry.level}`}>
                      <span className="cp-log-ic">{levelIcon(entry.level)}</span>
                      <span className="cp-log-msg">{entry.message}</span>
                    </div>
                  ))
                )}
              </div>
              <button
                className="btn-ghost btn-sm cp-log-clear"
                onClick={onClearLogs}
                disabled={logs.length === 0}
              >
                지우기
              </button>
            </>
          )}
        </div>
      )}
```

- [ ] **Step 2: `CrawlModal.tsx` — isAdmin prop 추가 + 전달**

`CrawlModalProps`(6-19행)에 `isAdmin: boolean;` 추가. 구조분해(21-24행)에 `isAdmin` 추가. `CrawlProgressPanel` 호출(44-51행)에 `isAdmin={isAdmin}` 추가:

```tsx
            <CrawlProgressPanel
              dongs={dongs}
              logs={logs}
              status={status}
              regionName={regionName}
              isAdmin={isAdmin}
              onClearLogs={onClearLogs}
              onSkipDong={onSkipDong}
            />
```

- [ ] **Step 3: `NaverCrawlerTab.tsx` — props 에 isAdmin 추가**

`NaverCrawlerTabProps`(17-22행)에 `isAdmin: boolean;` 추가, 구조분해(27행)에 `isAdmin` 추가:

```tsx
interface NaverCrawlerTabProps {
  crawler: ReturnType<typeof useCrawler>;
  slots: ReturnType<typeof useSlots>;
  session: Session | null;
  agentStatus: AgentStatusHook;
  isAdmin: boolean;
}

const AGENT_DOWNLOAD_URL =
  'https://github.com/BanaPapa/Estate-OS/releases/latest/download/Estate-OS-Agent-Setup.exe';

export function NaverCrawlerTab({ crawler, slots, session, agentStatus, isAdmin }: NaverCrawlerTabProps) {
```

`CrawlModal` 렌더(550행 부근)에 `isAdmin={isAdmin}` 추가:

```tsx
        <CrawlModal
          dongs={state.dongs}
          logs={state.logs}
          status={state.status}
          isAdmin={isAdmin}
          regionName={state.regionName}
```

- [ ] **Step 4: `NaverCrawlerTab.tsx` — 검색 로깅 effect 추가**

상단 import에 추가:

```ts
import { startSearchLog, finishSearchLog } from '../services/searchLogsRepo';
```

`export function NaverCrawlerTab(...)` 본문 안, 기존 상태 선언 근처(예: 38행 이후)에 ref 추가:

```ts
  const searchLogIdRef = useRef<string | null>(null);
```

`state.status` 전이를 감시하는 effect를 추가(기존 155-158행 error effect 아래에 둔다):

```tsx
  // 검색 활동 로깅 — 시작 시 요약 행 생성, 종료 시 상태 갱신 (실패는 검색을 막지 않음)
  const prevStatusRef = useRef<typeof state.status>('idle');
  useEffect(() => {
    const prev = prevStatusRef.current;
    const cur = state.status;
    prevStatusRef.current = cur;
    if (prev === cur) return;

    if (cur === 'running' && prev !== 'running') {
      searchLogIdRef.current = null;
      startSearchLog(state.meta).then((id) => {
        searchLogIdRef.current = id;
      });
    } else if ((cur === 'done' || cur === 'error' || cur === 'stopped') && prev === 'running') {
      finishSearchLog(searchLogIdRef.current, {
        status: cur,
        resultCount: state.properties.length,
        errorMessage: cur === 'error' ? state.errorMessage ?? undefined : undefined,
      });
    }
  }, [state.status, state.meta, state.properties.length, state.errorMessage]);
```

(주의: `useRef`/`useEffect`는 이미 import 됨 — 1행 `import React, { useState, useEffect, useMemo, useRef } from 'react';`)

- [ ] **Step 5: `App.tsx` — NaverCrawlerTab 에 isAdmin 전달**

116행:

```tsx
          <NaverCrawlerTab crawler={crawler} slots={slots} session={auth.session} agentStatus={agentStatus} isAdmin={isAdmin} />
```

- [ ] **Step 6: 타입체크 + 빌드**

Run: `npm run typecheck && npm run build`
Expected: 둘 다 에러 없이 통과.

- [ ] **Step 7: 수동 검증 (dev 서버)**

Run: `npm run dev` → 브라우저에서 검색 실행.
- 관리자 계정: 진행 모달 하단 "상세 로그" 토글이 보임.
- (일반 사용자 계정이 있으면) "상세 로그" 토글이 안 보임.
- Supabase Dashboard → `search_logs` 테이블에 행이 생기고 종료 시 status/result_count 갱신됨.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/NaverCrawlerTab.tsx src/components/CrawlModal.tsx src/components/CrawlProgressPanel.tsx
git commit -m "feat: 검색 활동 로깅 + 상세로그 관리자 전용 게이팅"
```

---

## Task 5: 관리자 회원 상세 모달 — 검색내역 탭

**Files:**
- Create: `src/components/admin/MemberDetailModal.tsx`
- Modify: `src/components/admin/MemberApproval.tsx` (행 더블클릭 → 모달, "상세" 버튼)

- [ ] **Step 1: `src/components/admin/MemberDetailModal.tsx` 생성 (검색내역 탭만; 문의 탭은 Task 7에서 추가)**

```tsx
import React, { useEffect, useState } from 'react';
import { listSearchLogs, type SearchLog } from '../../services/searchLogsRepo';
import type { Profile } from '../../services/profilesRepo';
import { REAL_ESTATE_TYPES, TRADE_TYPE_LABELS } from '../../types';

interface MemberDetailModalProps {
  member: Profile;
  onClose: () => void;
}

type DetailTab = 'search' | 'inquiry';

function productLabel(code: string): string {
  return REAL_ESTATE_TYPES.find((t) => t.value === code)?.label ?? code;
}

function regionLabel(l: SearchLog): string {
  return [l.largeName, l.midName, l.smallName].filter(Boolean).join(' ') || '—';
}

function statusLabel(s: SearchLog['status']): string {
  switch (s) {
    case 'done': return '완료';
    case 'error': return '실패';
    case 'stopped': return '중지';
    case 'running': return '진행중';
  }
}

export function MemberDetailModal({ member, onClose }: MemberDetailModalProps) {
  const [tab, setTab] = useState<DetailTab>('search');
  const [logs, setLogs] = useState<SearchLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listSearchLogs(member.id)
      .then((rows) => { if (alive) setLogs(rows); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [member.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card member-detail" onClick={(e) => e.stopPropagation()}>
        <button className="cm-close" onClick={onClose} title="닫기">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>

        <h3 className="md-title">{member.name || member.email || '회원'} 상세</h3>
        <p className="md-sub">{member.email}</p>

        <div className="md-tabs">
          <button className={`md-tab${tab === 'search' ? ' active' : ''}`} onClick={() => setTab('search')}>
            검색내역
          </button>
          <button className={`md-tab${tab === 'inquiry' ? ' active' : ''}`} onClick={() => setTab('inquiry')}>
            문의
          </button>
        </div>

        {tab === 'search' && (
          <div className="md-search">
            {loading ? (
              <div className="md-empty">불러오는 중…</div>
            ) : error ? (
              <div className="auth-msg err">{error}</div>
            ) : logs.length === 0 ? (
              <div className="md-empty">최근 6개월 검색내역이 없습니다.</div>
            ) : (
              <div className="md-log-table">
                <div className="md-log-row md-log-head">
                  <span>시각</span><span>지역</span><span>상품</span><span>거래</span>
                  <span>면적</span><span>결과</span><span>상태</span>
                </div>
                {logs.map((l) => (
                  <div className="md-log-row" key={l.id}>
                    <span className="md-log-time">{new Date(l.createdAt).toLocaleString('ko-KR', { hour12: false })}</span>
                    <span>{regionLabel(l)}</span>
                    <span>{productLabel(l.realEstateType)}</span>
                    <span>{l.tradeType ? (TRADE_TYPE_LABELS[l.tradeType] ?? l.tradeType) : '—'}</span>
                    <span>{l.areaLabel || '—'}</span>
                    <span>{l.resultCount != null ? `${l.resultCount.toLocaleString()}건` : '—'}</span>
                    <span className={`md-log-status ${l.status}`}>{statusLabel(l.status)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'inquiry' && (
          <div className="md-inquiry-placeholder md-empty">문의 기능은 곧 추가됩니다.</div>
        )}
      </div>
    </div>
  );
}
```

(주의: `REAL_ESTATE_TYPES`, `TRADE_TYPE_LABELS` 는 `src/types/index.ts`에 이미 export됨. `md-inquiry-placeholder` 자리는 Task 7에서 실제 스레드 UI로 교체.)

- [ ] **Step 2: `MemberApproval.tsx` — 행 더블클릭/상세 버튼으로 모달 오픈**

상단 import 추가:

```ts
import { MemberDetailModal } from './MemberDetailModal';
```

`MemberApproval` 컴포넌트 상태에 추가(21행 `busyId` 근처):

```ts
  const [detailMember, setDetailMember] = useState<Profile | null>(null);
```

`MemberTable` 에 `onOpenDetail` prop 전달이 필요하므로 `MemberTableProps`(173-178행)에 추가:

```ts
interface MemberTableProps {
  rows: Profile[];
  busyId: string | null;
  onStatusChange: (id: string, status: ProfileStatus) => void;
  onInfoChange: (id: string, fields: { name?: string; company?: string; position?: string; phone?: string }) => void;
  onOpenDetail: (member: Profile) => void;
}
```

`MemberTable` 시그니처(180-181행) 및 두 호출처(95행, 106행)에 `onOpenDetail={setDetailMember}` 추가. 예) 95행:

```tsx
          <MemberTable rows={pending} busyId={busyId} onStatusChange={changeStatus} onInfoChange={changeInfo} onOpenDetail={setDetailMember} />
```

106행도 동일하게 `onOpenDetail={setDetailMember}` 추가.

`MemberTable` 함수(180행)에 prop 받기:

```tsx
function MemberTable({ rows, busyId, onStatusChange, onInfoChange, onOpenDetail }: MemberTableProps) {
```

회원 행(`<div className="member-row" key={p.id}>`, 198행)에 더블클릭 핸들러 추가:

```tsx
          <div className="member-row" key={p.id} onDoubleClick={() => onOpenDetail(p)}>
```

기존 `EditableCell` 의 편집 트리거가 행 더블클릭과 충돌하지 않도록, `EditableCell` 의 표시 `<span>`(161-169행) `onDoubleClick` 에 `stopPropagation` 추가:

```tsx
  return (
    <span
      className="member-editable"
      title="더블클릭하여 수정"
      onDoubleClick={(e) => { e.stopPropagation(); startEdit(); }}
    >
      {value || <span className="member-empty-val">{placeholder}</span>}
    </span>
  );
```

"작업" 셀(243행 `<span className="member-actions">`)에 상세 버튼 추가(기존 승인/거절 버튼과 함께, 비관리자 분기 안 또는 공통). 공통으로 두려면 `member-actions` 맨 앞에:

```tsx
            <span className="member-actions">
              <button className="member-btn detail" onClick={() => onOpenDetail(p)} title="상세 보기">상세</button>
              {isAdmin ? (
```

`MemberApproval` 의 return 최상위 `<main>` 닫기 직전(109행 `</main>` 위)에 모달 렌더 추가:

```tsx
      {detailMember && (
        <MemberDetailModal member={detailMember} onClose={() => setDetailMember(null)} />
      )}
```

- [ ] **Step 3: 최소 스타일 추가**

`src/index.css` 끝에 추가:

```css
/* 회원 상세 모달 */
.member-detail { width: min(880px, 94vw); max-height: 86vh; overflow: auto; position: relative; }
.md-title { margin: 4px 0 2px; }
.md-sub { color: var(--muted, #8b949e); font-size: 13px; margin: 0 0 14px; }
.md-tabs { display: flex; gap: 6px; border-bottom: 1px solid #21262d; margin-bottom: 12px; }
.md-tab { background: none; border: none; color: #8b949e; padding: 8px 14px; cursor: pointer; border-bottom: 2px solid transparent; }
.md-tab.active { color: #fff; border-bottom-color: #00d4aa; }
.md-empty { color: #8b949e; padding: 24px; text-align: center; }
.md-log-table { display: flex; flex-direction: column; font-size: 13px; }
.md-log-row { display: grid; grid-template-columns: 150px 1.6fr 1.4fr 60px 90px 70px 64px; gap: 8px; padding: 7px 8px; border-bottom: 1px solid #1b2027; align-items: center; }
.md-log-head { color: #8b949e; font-weight: 600; position: sticky; top: 0; background: #0d1117; }
.md-log-time { color: #8b949e; white-space: nowrap; }
.md-log-status.done { color: #00d4aa; }
.md-log-status.error { color: #f7768e; }
.md-log-status.stopped { color: #e3b341; }
.md-log-status.running { color: #58a6ff; }
.member-btn.detail { background: #21262d; color: #c9d1d9; }
```

- [ ] **Step 4: 타입체크 + 빌드**

Run: `npm run typecheck && npm run build`
Expected: 통과.

- [ ] **Step 5: 수동 검증**

관리자로 로그인 → 회원관리 탭 → 회원 행 더블클릭(또는 "상세" 버튼) → 모달 오픈 → 검색내역 탭에 해당 회원의 검색 요약이 최신순으로 표시. 이름/회사 셀 더블클릭은 여전히 인라인 편집만 동작(모달 안 열림).

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/MemberDetailModal.tsx src/components/admin/MemberApproval.tsx src/index.css
git commit -m "feat: 관리자 회원 상세 모달 + 검색내역 탭"
```

---

## Task 6: 사용자 문의 모달 + 사이드바 진입점 + 실패 모달 CTA

**Files:**
- Create: `src/hooks/useInquiries.ts`
- Create: `src/components/inquiry/InquiryModal.tsx`
- Modify: `src/components/Sidebar.tsx` (하단 "관리자에게 문의하기" 항목 + 배지)
- Modify: `src/App.tsx` (useInquiries 와이어링, InquiryModal 렌더)
- Modify: `src/components/NaverCrawlerTab.tsx` (비관리자 실패 모달 → 문의 CTA)

- [ ] **Step 1: `src/hooks/useInquiries.ts` 생성**

```ts
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import {
  listMyThread, sendUserMessage, markThreadReadByUser, countUserUnread,
  type InquiryMessage,
} from '../services/inquiriesRepo';

// 사용자(본인) 1:1 문의 스레드 + 미읽음 + Realtime.
export function useInquiries(session: Session | null) {
  const [thread, setThread] = useState<InquiryMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const uid = session?.user?.id ?? null;

  const reload = useCallback(async () => {
    if (!uid) { setThread([]); setUnread(0); return; }
    try {
      setThread(await listMyThread());
      setUnread(await countUserUnread());
    } catch (err) {
      console.warn('문의 스레드 로드 실패:', err);
    }
  }, [uid]);

  useEffect(() => { reload(); }, [reload]);

  // Realtime: 내 스레드에 admin 답변이 insert 되면 갱신
  useEffect(() => {
    if (!supabase || !uid) return;
    const ch = supabase
      .channel(`inq-user-${uid}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'inquiries', filter: `user_id=eq.${uid}` },
        () => { reload(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, reload]);

  const send = useCallback(async (body: string, context?: Record<string, unknown>) => {
    await sendUserMessage(body, context);
    await reload();
  }, [reload]);

  const markRead = useCallback(async () => {
    await markThreadReadByUser();
    setUnread(0);
    setThread((prev) => prev.map((m) => (m.senderRole === 'admin' ? { ...m, readByUser: true } : m)));
  }, []);

  return { thread, unread, reload, send, markRead };
}
```

- [ ] **Step 2: `src/components/inquiry/InquiryModal.tsx` 생성**

```tsx
import React, { useEffect, useRef, useState } from 'react';
import type { InquiryMessage } from '../../services/inquiriesRepo';

interface InquiryModalProps {
  thread: InquiryMessage[];
  prefillContext?: Record<string, unknown> | null;
  onSend: (body: string, context?: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

const MAX_LEN = 2000;

export function InquiryModal({ thread, prefillContext, onSend, onClose }: InquiryModalProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [thread]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(body, prefillContext ?? undefined);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card inquiry-modal" onClick={(e) => e.stopPropagation()}>
        <button className="cm-close" onClick={onClose} title="닫기">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <h3 className="iq-title">관리자에게 문의</h3>

        <div className="iq-thread" ref={bodyRef}>
          {thread.length === 0 ? (
            <div className="iq-empty">아직 주고받은 메시지가 없습니다. 문의 내용을 입력해 주세요.</div>
          ) : (
            thread.map((m) => (
              <div key={m.id} className={`iq-msg ${m.senderRole}`}>
                <div className="iq-bubble">{m.body}</div>
                <div className="iq-meta">
                  {m.senderRole === 'admin' ? '관리자' : '나'} · {new Date(m.createdAt).toLocaleString('ko-KR', { hour12: false })}
                </div>
              </div>
            ))
          )}
        </div>

        {prefillContext && (
          <div className="iq-context">첨부된 오류 정보가 함께 전송됩니다.</div>
        )}
        {error && <div className="auth-msg err">{error}</div>}

        <div className="iq-input">
          <textarea
            value={draft}
            maxLength={MAX_LEN}
            placeholder="문의 내용을 입력하세요…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
          />
          <button className="eos-run-btn iq-send" disabled={sending || !draft.trim()} onClick={submit}>
            {sending ? '전송 중…' : '보내기'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `Sidebar.tsx` — 하단 "관리자에게 문의하기" 항목 + 배지**

`SidebarProps`(150-158행)에 추가:

```ts
interface SidebarProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  userEmail?: string | null;
  onSignOut?: () => void;
  isAdmin?: boolean;
  onOpenInquiry?: () => void;  // 지정 시 하단 '관리자에게 문의하기' 노출 (비관리자 사용자)
  inquiryUnread?: number;      // 사용자 미읽음(관리자 답변) 수
  adminInboxUnread?: number;   // 관리자: 회원 승인 탭 배지용 미읽음 문의 수
}
```

함수 시그니처(160행)에 구조분해 추가: `onOpenInquiry, inquiryUnread = 0, adminInboxUnread = 0`.

회원 승인 버튼(201-214행)에 관리자 배지 추가 — `<span className="eos-nav-label">회원 승인</span>` 뒤에:

```tsx
            <span className="eos-nav-label">회원 승인</span>
            {adminInboxUnread > 0 && <span className="eos-nav-badge">{adminInboxUnread}</span>}
            <span className="eos-dot live" />
```

계정 영역(`<div className="eos-acct">`, 228행) **바로 위**에 문의 항목 추가:

```tsx
      {onOpenInquiry && (
        <button className="eos-nav-item eos-inquiry-btn" title="관리자에게 문의하기" onClick={onOpenInquiry}>
          <svg className="ic" viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="eos-nav-label">관리자에게 문의하기</span>
          {inquiryUnread > 0 && <span className="eos-nav-badge">{inquiryUnread}</span>}
        </button>
      )}
```

- [ ] **Step 4: `App.tsx` — useInquiries 와이어링 + InquiryModal 렌더**

import 추가:

```ts
import { useInquiries } from './hooks/useInquiries';
import { InquiryModal } from './components/inquiry/InquiryModal';
```

`useAuth()` 등 훅 근처(18-22행)에 추가:

```ts
  const inquiries = useInquiries(auth.session);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [inquiryPrefill, setInquiryPrefill] = useState<Record<string, unknown> | null>(null);
```

문의 모달 오픈 핸들러(컴포넌트 본문, return 위)에 추가:

```ts
  const openInquiry = (prefill?: Record<string, unknown> | null) => {
    setInquiryPrefill(prefill ?? null);
    setInquiryOpen(true);
    inquiries.markRead();
  };
```

`Sidebar`(71-79행)에 props 추가 — 비관리자에게만 문의 항목 노출:

```tsx
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          collapsed={sideCollapsed}
          onToggleCollapse={() => setSideCollapsed((v) => !v)}
          userEmail={auth.user?.email ?? null}
          onSignOut={auth.configured ? auth.signOut : undefined}
          isAdmin={isAdmin}
          onOpenInquiry={auth.configured && !isAdmin ? () => openInquiry() : undefined}
          inquiryUnread={inquiries.unread}
        />
```

`NaverCrawlerTab`(116행)에 실패 시 문의 오픈 콜백 전달(props는 Step 5에서 추가):

```tsx
          <NaverCrawlerTab crawler={crawler} slots={slots} session={auth.session} agentStatus={agentStatus} isAdmin={isAdmin} onRequestInquiry={openInquiry} />
```

`eos-main` 닫기 직전 또는 앱 루트 끝에 모달 렌더 추가(122행 `</div>` 들 사이, 최상위 `eos-app` 안):

```tsx
      {inquiryOpen && (
        <InquiryModal
          thread={inquiries.thread}
          prefillContext={inquiryPrefill}
          onSend={inquiries.send}
          onClose={() => setInquiryOpen(false)}
        />
      )}
```

- [ ] **Step 5: `NaverCrawlerTab.tsx` — 비관리자 실패 모달 + 문의 CTA**

`NaverCrawlerTabProps`에 추가: `onRequestInquiry: (prefill?: Record<string, unknown> | null) => void;` (구조분해에도 `onRequestInquiry` 추가).

상태 추가(38행 근처):

```ts
  const [failure, setFailure] = useState<{ message: string; context: Record<string, unknown> } | null>(null);
```

크롤토큰 실패 처리(87-90행)를 역할에 따라 분기 — 기존:
```tsx
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          setNotice(`크롤 토큰 발급 실패: ${msg}`);
        });
```
를 다음으로 교체:
```tsx
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (isAdmin) {
            setNotice(`크롤 토큰 발급 실패: ${msg}`);
          } else {
            setFailure({ message: '데이터 수집 준비 중 문제가 발생했습니다.', context: { kind: 'crawl-token', error: msg } });
          }
        });
```

검색 자체 실패(크롤러 error)도 비관리자에게 실패 모달. 검색 로깅 effect(Task 4 Step 4) 아래에 추가:

```tsx
  // 비관리자: 백그라운드 검색 실패 시 문의 유도 모달
  useEffect(() => {
    if (isAdmin) return;
    if (state.status === 'error') {
      const err = state.errorMessage ?? '알 수 없는 오류';
      setFailure({
        message: '검색 중 문제가 발생했습니다. 관리자에게 문의해 주세요.',
        context: {
          kind: 'search-error',
          error: err,
          region: [state.meta.largeName, state.meta.midName, state.meta.smallName].filter(Boolean).join(' '),
          product: state.meta.realEstateType,
        },
      });
    }
  }, [state.status, state.errorMessage, state.meta, isAdmin]);
```

실패 모달 렌더 — 기존 `{notice && <InfoModal .../>}`(580행) 아래에 추가:

```tsx
      {failure && (
        <div className="modal-overlay" onClick={() => setFailure(null)}>
          <div className="modal-card fail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fail-ic">!</div>
            <p className="fail-msg">{failure.message}</p>
            <div className="fail-actions">
              <button className="btn-ghost" onClick={() => setFailure(null)}>닫기</button>
              <button
                className="eos-run-btn"
                onClick={() => { const ctx = failure.context; setFailure(null); onRequestInquiry(ctx); }}
              >
                관리자에게 문의
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 6: 최소 스타일 추가**

`src/index.css` 끝에 추가:

```css
/* 문의 모달 / 실패 모달 / 사이드바 배지 */
.eos-nav-badge { margin-left: auto; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #f7768e; color: #fff; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.eos-inquiry-btn { margin-top: auto; }
.inquiry-modal { width: min(560px, 94vw); max-height: 84vh; display: flex; flex-direction: column; position: relative; }
.iq-title { margin: 2px 0 12px; }
.iq-thread { flex: 1; overflow-y: auto; min-height: 200px; display: flex; flex-direction: column; gap: 10px; padding: 6px 2px; }
.iq-empty { color: #8b949e; text-align: center; padding: 32px 12px; }
.iq-msg { display: flex; flex-direction: column; max-width: 78%; }
.iq-msg.user { align-self: flex-end; align-items: flex-end; }
.iq-msg.admin { align-self: flex-start; align-items: flex-start; }
.iq-bubble { padding: 9px 12px; border-radius: 12px; font-size: 14px; white-space: pre-wrap; word-break: break-word; }
.iq-msg.user .iq-bubble { background: #00d4aa; color: #04221c; }
.iq-msg.admin .iq-bubble { background: #21262d; color: #e6edf3; }
.iq-meta { font-size: 11px; color: #8b949e; margin-top: 3px; }
.iq-context { font-size: 12px; color: #e3b341; margin: 8px 0 0; }
.iq-input { display: flex; gap: 8px; margin-top: 10px; }
.iq-input textarea { flex: 1; min-height: 56px; resize: vertical; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; color: #e6edf3; padding: 8px 10px; font-family: inherit; }
.iq-send { white-space: nowrap; align-self: flex-end; }
.fail-modal { width: min(420px, 92vw); text-align: center; padding: 26px; position: relative; }
.fail-ic { width: 46px; height: 46px; margin: 0 auto 14px; border-radius: 50%; background: #f7768e22; color: #f7768e; font-size: 26px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.fail-msg { color: #e6edf3; margin: 0 0 18px; line-height: 1.5; }
.fail-actions { display: flex; gap: 10px; justify-content: center; }
```

- [ ] **Step 7: 타입체크 + 빌드**

Run: `npm run typecheck && npm run build`
Expected: 통과.

- [ ] **Step 8: 수동 검증**

- 비관리자 로그인 → 사이드바 하단 "관리자에게 문의하기" 보임 → 클릭 → 모달 → 메시지 전송 → `inquiries` 테이블에 user 행 생성.
- 비관리자가 검색 실패를 유발(에이전트 끄고 검색 등) → 실패 모달 → "관리자에게 문의" → 문의 모달이 오류 맥락과 함께 열림.
- 관리자 로그인 시 사이드바에 문의 항목이 안 보임(대신 회원 승인 배지).

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useInquiries.ts src/components/inquiry/InquiryModal.tsx src/components/Sidebar.tsx src/App.tsx src/components/NaverCrawlerTab.tsx src/index.css
git commit -m "feat: 사용자 1:1 문의 모달 + 사이드바 진입점 + 실패 모달 CTA"
```

---

## Task 7: 관리자 답변(문의 탭) + Realtime 알림 배지

**Files:**
- Create: `src/hooks/useAdminInbox.ts`
- Modify: `src/components/admin/MemberDetailModal.tsx` (문의 탭 실제 구현)
- Modify: `src/components/admin/MemberApproval.tsx` (행 미읽음 dot)
- Modify: `src/App.tsx` (useAdminInbox → Sidebar 배지 + MemberApproval 전달)

- [ ] **Step 1: `src/hooks/useAdminInbox.ts` 생성**

```ts
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { countAdminUnread, listUnreadUserIds } from '../services/inquiriesRepo';

// 관리자: 전체 미읽음 문의 수 + 미읽음 사용자 id 집합 + Realtime.
export function useAdminInbox(enabled: boolean) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadUserIds, setUnreadUserIds] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    if (!enabled) { setUnreadCount(0); setUnreadUserIds(new Set()); return; }
    try {
      setUnreadCount(await countAdminUnread());
      setUnreadUserIds(new Set(await listUnreadUserIds()));
    } catch (err) {
      console.warn('관리자 문의함 로드 실패:', err);
    }
  }, [enabled]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!supabase || !enabled) return;
    const ch = supabase
      .channel('inq-admin-inbox')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'inquiries' },
        () => { reload(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [enabled, reload]);

  return { unreadCount, unreadUserIds, reload };
}
```

- [ ] **Step 2: `MemberDetailModal.tsx` — 문의 탭 실제 구현**

import 추가:

```ts
import { listThread, sendAdminReply, markThreadReadByAdmin, type InquiryMessage } from '../../services/inquiriesRepo';
```

props 에 콜백 추가(읽음 처리 후 부모 inbox 갱신용):

```ts
interface MemberDetailModalProps {
  member: Profile;
  onClose: () => void;
  onThreadRead?: () => void;
}
```

함수 구조분해에 `onThreadRead` 추가. 컴포넌트 내부 상태 추가:

```ts
  const [thread, setThread] = useState<InquiryMessage[]>([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
```

문의 탭 진입 시 스레드 로드 + 읽음 처리 effect 추가:

```tsx
  useEffect(() => {
    if (tab !== 'inquiry') return;
    let alive = true;
    listThread(member.id).then((rows) => { if (alive) setThread(rows); }).catch(() => {});
    markThreadReadByAdmin(member.id).then(() => onThreadRead?.());
    return () => { alive = false; };
  }, [tab, member.id, onThreadRead]);

  const sendReply = async () => {
    const body = reply.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await sendAdminReply(member.id, body);
      setReply('');
      setThread(await listThread(member.id));
    } catch (err) {
      console.warn('답변 전송 실패:', err);
    } finally {
      setSending(false);
    }
  };
```

문의 탭 placeholder 블록(Task 5 Step 1의 `md-inquiry-placeholder`)을 다음으로 교체:

```tsx
        {tab === 'inquiry' && (
          <div className="md-inquiry">
            <div className="iq-thread">
              {thread.length === 0 ? (
                <div className="iq-empty">문의 내역이 없습니다.</div>
              ) : (
                thread.map((m) => (
                  <div key={m.id} className={`iq-msg ${m.senderRole}`}>
                    <div className="iq-bubble">{m.body}</div>
                    {m.context && (
                      <div className="iq-meta">오류정보: {JSON.stringify(m.context)}</div>
                    )}
                    <div className="iq-meta">
                      {m.senderRole === 'admin' ? '관리자' : member.name || '사용자'} · {new Date(m.createdAt).toLocaleString('ko-KR', { hour12: false })}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="iq-input">
              <textarea
                value={reply}
                maxLength={2000}
                placeholder="답변을 입력하세요…"
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendReply(); }}
              />
              <button className="eos-run-btn iq-send" disabled={sending || !reply.trim()} onClick={sendReply}>
                {sending ? '전송 중…' : '답변'}
              </button>
            </div>
          </div>
        )}
```

- [ ] **Step 3: `MemberApproval.tsx` — 미읽음 dot + inbox 갱신 전달**

`MemberApproval` 에 `unreadUserIds: Set<string>` 와 `onThreadRead: () => void` props 를 받도록 변경:

```ts
interface MemberApprovalProps {
  unreadUserIds: Set<string>;
  onThreadRead: () => void;
}

export function MemberApproval({ unreadUserIds, onThreadRead }: MemberApprovalProps) {
```

`MemberTableProps` 와 `MemberTable` 에 `unreadUserIds` 전달. 회원 행의 이메일 셀(199행 `<span className="member-email">`) 앞에 dot 추가:

```tsx
            <span className="member-email">
              {unreadUserIds.has(p.id) && <span className="member-unread-dot" title="새 문의" />}
              {p.email ?? '(이메일 없음)'}
            </span>
```

(두 `MemberTable` 호출처에 `unreadUserIds={unreadUserIds}` 추가. `MemberDetailModal` 렌더에 `onThreadRead={onThreadRead}` 추가.)

- [ ] **Step 4: `App.tsx` — useAdminInbox 와이어링**

import 추가: `import { useAdminInbox } from './hooks/useAdminInbox';`

훅 호출 추가(근처):

```ts
  const adminInbox = useAdminInbox(isAdmin);
```

`Sidebar` 에 `adminInboxUnread={adminInbox.unreadCount}` 추가.

`MemberApproval` 렌더(118행)를 다음으로 교체:

```tsx
        {isAdminTab && isAdmin && (
          <MemberApproval unreadUserIds={adminInbox.unreadUserIds} onThreadRead={adminInbox.reload} />
        )}
```

(주의: `isAdmin`은 `auth.profile` 로딩 후 결정되므로, `useAdminInbox(isAdmin)` 가 false→true 전환 시 자동 reload 됨 — 훅의 deps에 enabled 포함.)

- [ ] **Step 5: 최소 스타일 추가**

`src/index.css` 끝에 추가:

```css
.member-unread-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #f7768e; margin-right: 6px; vertical-align: middle; }
.md-inquiry { display: flex; flex-direction: column; }
.md-inquiry .iq-thread { max-height: 46vh; }
```

- [ ] **Step 6: 타입체크 + 빌드**

Run: `npm run typecheck && npm run build`
Expected: 통과.

- [ ] **Step 7: 수동 검증 (2계정 또는 2브라우저)**

- 사용자가 문의 전송 → 관리자 사이드바 "회원 승인" 배지 숫자 즉시 증가(Realtime), 회원 행에 빨간 dot.
- 관리자가 회원 더블클릭 → 문의 탭 → 메시지 보임 + dot/배지 사라짐(읽음 처리) → 답변 전송.
- 사용자 화면: 문의 모달 다시 열면 관리자 답변이 보이고, 사이드바 문의 배지로 미읽음 표시.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useAdminInbox.ts src/components/admin/MemberDetailModal.tsx src/components/admin/MemberApproval.tsx src/App.tsx src/index.css
git commit -m "feat: 관리자 문의 답변 탭 + Realtime 미읽음 배지/알림"
```

---

## 최종 검증 (전체)

- [ ] `npm run typecheck && npm run build` 통과
- [ ] Supabase: `search_logs`/`inquiries` RLS로 비관리자는 본인 행만 조회됨(다른 사용자 id로 조회 시도 시 빈 결과)
- [ ] 일반 사용자: 상세로그 숨김 + 실패 모달 + 문의; 관리자: 상세로그 노출 + 회원상세(검색내역/문의) + 실시간 배지
- [ ] 배포(Vercel): `git push origin master` 후 프로덕션에서 동일 동작 확인

---

## Self-Review 결과 (작성자 확인)

- **Spec 커버리지:** 5개 요구사항 모두 태스크 매핑됨 — (1) 상세로그 게이팅=Task4, (2) 실패 모달=Task6, (3) 회원 검색내역=Task5, (4) 1:1 문의=Task6+7, (5) 관리자 알림=Task7. 6개월 보존=Task1(읽기 필터+정리함수)+Task2(listSearchLogs gte). 사이드바 하단 위치=Task6 Step3.
- **Placeholder:** Task5의 문의 탭 placeholder는 Task7에서 실제 구현으로 교체(의도된 단계적 구현, 각 단계가 빌드 통과). 그 외 TBD/TODO 없음.
- **타입 일관성:** `SearchLog`/`InquiryMessage` 타입과 repo 함수 시그니처가 모든 소비처(컴포넌트/훅)와 일치. `finishSearchLog(id: string | null, ...)`는 null 허용으로 ref 값 직접 전달 가능. `useInquiries`/`useAdminInbox` 반환 형태가 App 와이어링과 일치.
- **테스트:** 러너 부재로 typecheck+build+수동검증으로 대체(스코프 명시).
