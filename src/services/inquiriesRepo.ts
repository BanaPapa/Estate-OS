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
