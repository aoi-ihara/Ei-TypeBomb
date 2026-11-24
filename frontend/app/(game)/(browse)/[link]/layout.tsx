import { notFound, redirect } from "next/navigation";
import Shell from "@/components/layout/Shell";
import { getRoomPageDataFromLink } from "@/lib/room/get";
import RoomPasswordGate from "./RoomPasswordGate";
import RoomViewerHint from "./RoomViewerHint";

export { generateMetadata } from "../../room-metadata";

export default async function RoomDetailsLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ link: string }>;
}) {
    const { link } = await params;
    const result = await getRoomPageDataFromLink(link);
    if (!result) notFound();
    if (link !== result.link) redirect("/" + result.link);
    if (result.requiresPassword && !result.authorized) {
        return (
            <div data-room-password-gate>
                <Shell title="パスワードを入力" size="medium" animateAppear showHeader={false}>
                    <RoomPasswordGate roomId={result.id} />
                </Shell>
            </div>
        );
    }

    return (
        <>
            <RoomViewerHint signedIn={result.isSignedIn} />
            {children}
        </>
    );
}
