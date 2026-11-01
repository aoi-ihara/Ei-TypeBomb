import { redirect } from "next/navigation";

export default async function LegacyRoomEditorRoute({
    params,
}: {
    params: Promise<{ link: string }>;
}) {
    const { link } = await params;
    redirect("/" + link + "/edit");
}
