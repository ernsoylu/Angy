import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { getPrisma } from "@angy/db";
import { ok, type ApiOk, type UserDto } from "@angy/shared";
import { SessionGuard } from "../auth/session.guard";

/** Enough to pick from without turning the picker into a directory dump. */
const SEARCH_LIMIT = 8;

@Controller("users")
@UseGuards(SessionGuard)
export class UsersController {
  /**
   * Typeahead for the editor's `@` mention picker.
   *
   * Workspace-wide rather than space-scoped: mentioning a colleague who cannot
   * yet read the page is a normal thing to do — it is how you tell someone they
   * should be given access — and restricting the list to current members would
   * silently make those people unmentionable. The mention itself grants
   * nothing, and every surface that lists mentions filters by read permission.
   *
   * Deactivated accounts are excluded: they are kept so existing mentions still
   * resolve to a name, not so new ones can be created.
   *
   * This does expose a name/email directory search to any signed-in user, which
   * is the same disclosure the share dialog's invite-by-email already makes.
   */
  @Get()
  async search(@Query("q") q: string | undefined): Promise<ApiOk<UserDto[]>> {
    const query = (q ?? "").trim();
    const users = await getPrisma().appUser.findMany({
      where: {
        deactivatedAt: null,
        ...(query === ""
          ? {}
          : {
              OR: [
                { displayName: { contains: query, mode: "insensitive" as const } },
                { email: { contains: query, mode: "insensitive" as const } },
              ],
            }),
      },
      orderBy: { displayName: "asc" },
      take: SEARCH_LIMIT,
    });
    return ok(
      users.map((user) => ({
        id: user.id.toString(),
        email: user.email,
        displayName: user.displayName,
      })),
    );
  }
}
