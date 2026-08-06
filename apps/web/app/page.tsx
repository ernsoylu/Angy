import { redirect } from "next/navigation";
import { getSpaces } from "../lib/api";

export default async function RootPage() {
  const spaces = await getSpaces();
  if (spaces.length === 0) redirect("/signin");
  redirect(`/s/${spaces[0]!.key}`);
}
