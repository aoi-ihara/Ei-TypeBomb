import { redirect } from "next/navigation";

export default async function LegacyPlaygroundPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    redirect("/" + slug + "/offline");
}
