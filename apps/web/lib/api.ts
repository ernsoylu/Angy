import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type {
  ApiResponse,
  AttachmentDto,
  PageDetailDto,
  PageListItemDto,
  PageSummaryDto,
  RevisionDto,
  SpaceDto,
  SpaceHomeDto,
  TrashItemDto,
  UserDto,
} from "@angy/shared";
import type { JSONContent } from "@angy/blocks";

/** Server-side base URL — the RSC render talks to the API directly. */
const API_URL = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function apiFetch<T>(path: string): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
  } catch {
    throw new Error("API_UNREACHABLE");
  }
  if (res.status === 401) redirect("/signin");
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.success) throw new Error(body.error.message);
  return body.data;
}

export const getMe = () => apiFetch<UserDto>("/auth/me");
export const getSpaces = () => apiFetch<SpaceDto[]>("/spaces");
export const getSpaceHome = (id: string) => apiFetch<SpaceHomeDto>(`/spaces/${id}/home`);
export const getSpacePages = (id: string) => apiFetch<PageSummaryDto[]>(`/spaces/${id}/pages`);
export const getPage = (id: string) => apiFetch<PageDetailDto>(`/pages/${id}`);
export const getRealtimeToken = (id: string) =>
  apiFetch<{ token: string }>(`/pages/${id}/realtime-token`);
export const getRevisions = (id: string) => apiFetch<RevisionDto[]>(`/pages/${id}/revisions`);
export const getSpaceAttachments = (spaceId: string) =>
  apiFetch<AttachmentDto[]>(`/spaces/${spaceId}/attachments`);
export const getSpaceTrash = (spaceId: string) =>
  apiFetch<TrashItemDto[]>(`/spaces/${spaceId}/trash`);
export const getRecentPages = (spaceId: string) =>
  apiFetch<PageListItemDto[]>(`/spaces/${spaceId}/recent`);
export const getStarredPages = (spaceId: string) =>
  apiFetch<PageListItemDto[]>(`/spaces/${spaceId}/starred`);
export const getSearchToken = () =>
  apiFetch<
    | { mode: "direct"; token: string; host: string; indexUid: string; expiresAt: string }
    | { mode: "proxy" }
  >("/search/token");
export const getRevisionContent = (id: string, version: number) =>
  apiFetch<{ version: number; documentJson: JSONContent }>(`/pages/${id}/revisions/${version}`);

export async function getSpaceByKey(key: string): Promise<SpaceDto | undefined> {
  const spaces = await getSpaces();
  return spaces.find((s) => s.key === key);
}
