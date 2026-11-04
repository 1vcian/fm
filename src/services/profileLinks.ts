/**
 * Profile links: keys an external app uses to read and update one profile
 * (supabase/migrations/0012_profile_links.sql). The owner's side only: the app itself calls
 * profile_link_read / profile_link_push with its key (public/profile-exchange/v1.md).
 */
import { getSupabaseClient, type SupabaseClient } from './supabaseClient';

export interface ProfileLink {
    id: string;
    profile_id: string;
    label: string;
    can_read: boolean;
    can_write: boolean;
    auto_apply: boolean;
    created_at: string;
    rotated_at: string | null;
    last_used_at: string | null;
}

export interface PendingPush {
    id: string;
    link_id: string;
    link_label: string;
    auto_apply: boolean;
    profile_id: string;
    format_version: number;
    payload: unknown;
    created_at: string;
}

/**
 * App links are a preview for now: shown only with debug=1 (or the site's debug=true) in the URL,
 * before or after the # route.
 */
export const linkedAppsEnabled = () => typeof window !== 'undefined' && /[?&]debug=(1|true)(?![\w])/.test(window.location.href);

export type LinkResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<LinkResult<T>> {
    const client: SupabaseClient | null = await getSupabaseClient();
    if (!client) return { ok: false, error: 'Sign in to use app links.' };
    const call = (client as unknown as { rpc: (n: string, p?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }> }).rpc;
    try {
        const { data, error } = await call.call(client, fn, args);
        if (error) return { ok: false, error: error.message || 'The server refused the request.' };
        return { ok: true, data: data as T };
    } catch (e: any) {
        return { ok: false, error: e?.message || 'No connection to the server.' };
    }
}

export const listLinks = (profileId?: string) => rpc<ProfileLink[]>('profile_links_list', { p_profile_id: profileId ?? null });
/** The key is in the answer once: it is stored hashed. */
export const createLink = (profileId: string, label: string, canRead: boolean, canWrite: boolean) =>
    rpc<{ id: string; token: string }>('profile_link_create', { p_profile_id: profileId, p_label: label, p_can_read: canRead, p_can_write: canWrite });
export const rotateLink = (linkId: string) => rpc<{ id: string; token: string }>('profile_link_rotate', { p_link_id: linkId });
export const revokeLink = (linkId: string) => rpc<null>('profile_link_revoke', { p_link_id: linkId });
export const setAutoApply = (linkId: string, auto: boolean) => rpc<null>('profile_link_set_auto_apply', { p_link_id: linkId, p_auto: auto });
export const pendingPushes = () => rpc<PendingPush[]>('profile_link_pushes_pending');
export const resolvePush = (pushId: string, status: 'applied' | 'dismissed') => rpc<null>('profile_link_push_resolve', { p_push_id: pushId, p_status: status });
export const setExport = (profileId: string, version: number, data: unknown) =>
    rpc<null>('profile_export_set', { p_profile_id: profileId, p_format_version: version, p_data: data });
