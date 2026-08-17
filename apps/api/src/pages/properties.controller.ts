import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { getDatabaseView, getEffectiveSpaceLevel, getPageValues, getPrisma } from "@angy/db";
import {
  createPropertySchema,
  databaseConfigSchema,
  ok,
  orderKeyBetween,
  satisfies,
  setPropertyValueSchema,
  type ApiOk,
  type CreatePropertyDto,
  type DatabaseConfigDto,
  type DatabaseViewDto,
  type PropertyDto,
  type PropertyValueDto,
} from "@angy/shared";
import { z } from "zod";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";
import { PagePermissionGuard, RequirePageLevel } from "../permissions/page-permission.guard";
import { ZodValidationPipe } from "../zod.pipe";

const setValuesSchema = z.object({ values: z.array(setPropertyValueSchema).max(50) });
type SetValuesDto = z.infer<typeof setValuesSchema>;

/** Ops that only mean something for an ordered type. */
const ORDERED_OPS = new Set(["gt", "lt"]);
const ORDERED_TYPES = new Set(["NUMBER", "DATE"]);

const toPropertyDto = (property: {
  id: bigint;
  name: string;
  type: PropertyDto["type"];
  options: string[];
}): PropertyDto => ({
  id: property.id.toString(),
  name: property.name,
  type: property.type,
  options: property.options,
});

/**
 * Page properties and database views (V2 H5.3, ADR 0013).
 *
 * The ADR's first slice, and no more of it: property definitions per space,
 * typed values per page, and one **read-only** table view over a page's
 * children. No boards, no calendars, no relations, no rollups — those all sit
 * downstream of whether this property model survives real data.
 *
 * Rows are Pages, so nothing here reimplements permissions, history, search or
 * trash — but it does have to *apply* them. Access to a page does not extend
 * to its children: `getEffectivePageLevel` reads the grant on that page alone,
 * with no walk up the closure table, so someone holding a page grant in a
 * private space can open the database and none of its rows. The row list is
 * therefore read-filtered per caller, and its total counts what survived.
 */
@Controller()
@UseGuards(SessionGuard, PagePermissionGuard)
export class PropertiesController {
  /** The space's property vocabulary. */
  @Get("spaces/:spaceId/properties")
  async list(
    @Param("spaceId") spaceId: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<PropertyDto[]>> {
    await this.assertSpace(req.user.id, spaceId, "VIEW");
    const properties = await getPrisma().pageProperty.findMany({
      where: { spaceId: BigInt(spaceId) },
      orderBy: [{ ord: "asc" }, { id: "asc" }],
    });
    return ok(properties.map(toPropertyDto));
  }

  /**
   * Coin a property. EDIT, like a tag: a vocabulary nobody but an admin can
   * extend is a vocabulary that stays empty. Deleting one is ADMIN, because it
   * takes every page's value with it.
   */
  @Post("spaces/:spaceId/properties")
  async create(
    @Param("spaceId") spaceId: string,
    @Body(new ZodValidationPipe(createPropertySchema)) body: CreatePropertyDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<PropertyDto>> {
    await this.assertSpace(req.user.id, spaceId, "EDIT");
    const prisma = getPrisma();
    if (body.type === "SELECT" && body.options.length === 0) {
      throw new BadRequestException("A select property needs at least one option");
    }
    const last = await prisma.pageProperty.findFirst({
      where: { spaceId: BigInt(spaceId) },
      orderBy: [{ ord: "desc" }, { id: "desc" }],
      select: { ord: true },
    });
    const existing = await prisma.pageProperty.findFirst({
      where: { spaceId: BigInt(spaceId), name: body.name },
    });
    if (existing) throw new BadRequestException("A property with that name already exists");

    const property = await prisma.pageProperty.create({
      data: {
        spaceId: BigInt(spaceId),
        name: body.name,
        type: body.type,
        options: body.options,
        ord: orderKeyBetween(last?.ord ?? null, null),
        createdBy: req.user.id,
      },
    });
    return ok(toPropertyDto(property));
  }

  @Delete("spaces/:spaceId/properties/:propertyId")
  async remove(
    @Param("spaceId") spaceId: string,
    @Param("propertyId") propertyId: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ deleted: true }>> {
    await this.assertSpace(req.user.id, spaceId, "ADMIN");
    await getPrisma().pageProperty.deleteMany({
      where: { id: BigInt(propertyId), spaceId: BigInt(spaceId) },
    });
    return ok({ deleted: true as const });
  }

  /** This page's values — the row's own cells. */
  @Get("pages/:id/properties")
  @RequirePageLevel("VIEW")
  async values(@Param("id") id: string): Promise<ApiOk<PropertyValueDto[]>> {
    return ok(await getPageValues(getPrisma(), id));
  }

  /**
   * Set values on a page. Cells are edited here, on the row's own page, and
   * never in the table: a view that writes back would make a projection an
   * edit target, which is the mistake hard rule 2 exists to prevent.
   */
  @Put("pages/:id/properties")
  @RequirePageLevel("EDIT")
  async setValues(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setValuesSchema)) body: SetValuesDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<PropertyValueDto[]>> {
    const prisma = getPrisma();
    const page = await prisma.page.findFirst({ where: { id, deletedAt: null } });
    if (!page) throw new NotFoundException("Page not found");

    const properties = await prisma.pageProperty.findMany({
      where: {
        id: { in: body.values.map((value) => BigInt(value.propertyId)) },
        // A property belongs to a space; setting one from another space would
        // put a column on a page no view of that space could explain.
        spaceId: page.spaceId,
      },
    });
    const byId = new Map(properties.map((property) => [property.id.toString(), property]));

    for (const entry of body.values) {
      const property = byId.get(entry.propertyId);
      if (!property) throw new BadRequestException("Unknown property for this space");

      if (entry.value === null) {
        await prisma.pagePropertyValue.deleteMany({
          where: { pageId: id, propertyId: property.id },
        });
        continue;
      }
      if (property.type === "SELECT" && !property.options.includes(entry.value)) {
        throw new BadRequestException(`"${entry.value}" is not an option of ${property.name}`);
      }

      const typed = typedValue(property.type, entry.value);
      if (typed === null) {
        throw new BadRequestException(`"${entry.value}" is not a valid ${property.type} value`);
      }
      await prisma.pagePropertyValue.upsert({
        where: { pageId_propertyId: { pageId: id, propertyId: property.id } },
        create: { pageId: id, propertyId: property.id, updatedBy: req.user.id, ...typed },
        update: { updatedBy: req.user.id, ...typed },
      });
    }

    return ok(await getPageValues(getPrisma(), id));
  }

  /** The view: columns, the filters and sorts behind them, and the rows. */
  @Get("pages/:id/database")
  @RequirePageLevel("VIEW")
  async view(
    @Param("id") id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<DatabaseViewDto | null>> {
    return ok(await getDatabaseView(getPrisma(), id, req.user.id));
  }

  /** Turn a page into a database, or reconfigure the one it already is. */
  @Put("pages/:id/database")
  @RequirePageLevel("EDIT")
  async configure(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(databaseConfigSchema)) body: DatabaseConfigDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<DatabaseViewDto>> {
    const prisma = getPrisma();
    const page = await prisma.page.findFirst({ where: { id, deletedAt: null } });
    if (!page) throw new NotFoundException("Page not found");

    const referenced = [
      ...new Set([
        ...body.columns,
        ...body.filters.map((filter) => filter.propertyId),
        ...body.sorts.map((sort) => sort.propertyId),
      ]),
    ];
    const properties = await prisma.pageProperty.findMany({
      where: { id: { in: referenced.map((value) => BigInt(value)) }, spaceId: page.spaceId },
    });
    if (properties.length !== referenced.length) {
      throw new BadRequestException("A column, filter or sort names a property of another space");
    }
    const byId = new Map(properties.map((property) => [property.id.toString(), property]));

    // Reject a filter the type cannot answer, here rather than at read time:
    // a view that silently drops half its filter shows more rows than it was
    // asked for, and nothing says why.
    for (const filter of body.filters) {
      const property = byId.get(filter.propertyId)!;
      if (ORDERED_OPS.has(filter.op) && !ORDERED_TYPES.has(property.type)) {
        throw new BadRequestException(
          `${property.name} is a ${property.type} — "${filter.op}" needs a number or a date`,
        );
      }
    }

    await prisma.pageDatabase.upsert({
      where: { pageId: id },
      create: {
        pageId: id,
        columns: body.columns.map((value) => BigInt(value)),
        filters: body.filters,
        sorts: body.sorts,
        createdBy: req.user.id,
      },
      update: {
        columns: body.columns.map((value) => BigInt(value)),
        filters: body.filters,
        sorts: body.sorts,
      },
    });
    return ok((await getDatabaseView(getPrisma(), id, req.user.id))!);
  }

  /** Stop being a database. The children stay children; only the view goes. */
  @Delete("pages/:id/database")
  @RequirePageLevel("EDIT")
  async unconfigure(@Param("id") id: string): Promise<ApiOk<{ deleted: true }>> {
    await getPrisma().pageDatabase.deleteMany({ where: { pageId: id } });
    return ok({ deleted: true as const });
  }

  private async assertSpace(userId: bigint, spaceId: string, level: "VIEW" | "EDIT" | "ADMIN") {
    const effective = await getEffectiveSpaceLevel(getPrisma(), userId, BigInt(spaceId));
    if (!satisfies(effective, level)) {
      throw new ForbiddenException("You don't have access to this space");
    }
  }
}

/** The typed column a value belongs in, or null if it does not parse. */
function typedValue(type: PropertyDto["type"], value: string) {
  switch (type) {
    case "NUMBER": {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? { numberValue: parsed } : null;
    }
    case "DATE": {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : { dateValue: parsed };
    }
    case "CHECKBOX":
      return { checkboxValue: value === "true" };
    case "USER":
      return /^\d+$/.test(value) ? { userValue: BigInt(value) } : null;
    default:
      return { textValue: value };
  }
}
