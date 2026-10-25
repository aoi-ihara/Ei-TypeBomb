import { redirect } from "next/navigation";

export default async function LegacyOnlinePage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    redirect("/" + slug + "/online");
}
