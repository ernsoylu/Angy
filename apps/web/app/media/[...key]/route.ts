import { NextResponse, type NextRequest } from "next/server";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEffectivePageLevel, getPrisma } from "@angy/db";
import { satisfies, type ApiResponse, type UserDto } from "@angy/shared";

/**
 * Serve-time media access (ADR 0007): documents embed the stable app-relative
 * /media/... form for private-space files; this route authenticates the
 * viewer, checks the containing page's permission, and redirects to a
 * short-lived signed URL. Public files use bare CDN URLs and never come here.
 */

const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

let s3: S3Client | undefined;

/**
 * Presigning only — never used to fetch bytes, so it points at the public
 * origin. SigV4 signs the Host header, so a URL signed against the internal
 * endpoint is rejected when the browser presents it to the public one.
 */
function client(): S3Client {
  s3 ??= new S3Client({
    endpoint: (
      process.env.S3_PUBLIC_ENDPOINT ??
      process.env.S3_ENDPOINT ??
      "http://localhost:9000"
    ).replace(/\/+$/, ""),
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "minioadmin",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin",
    },
  });
  return s3;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const s3Key = key.join("/");

  const me = await fetch(`${API_URL}/auth/me`, {
    headers: { cookie: request.headers.get("cookie") ?? "" },
    cache: "no-store",
  });
  if (me.status !== 200) return new NextResponse("Sign in required", { status: 401 });
  const body = (await me.json()) as ApiResponse<UserDto>;
  if (!body.success) return new NextResponse("Sign in required", { status: 401 });

  const prisma = getPrisma();
  // Thumbnails share the source object's key with a suffix and its permission.
  const sourceKey = s3Key.replace(/\.thumb\.webp$/, "");
  const attachment = await prisma.attachment.findFirst({
    where: { s3Key: sourceKey, deletedAt: null },
  });
  if (!attachment?.pageId) return new NextResponse("Not found", { status: 404 });

  const level = await getEffectivePageLevel(prisma, BigInt(body.data.id), attachment.pageId);
  if (!satisfies(level, "VIEW")) return new NextResponse("Not found", { status: 404 });

  const signed = await getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET ?? "angy-docs",
      Key: s3Key,
    }),
    { expiresIn: 300 },
  );
  return NextResponse.redirect(signed, { status: 302 });
}
