import type { Metadata } from "next";
import { getRoomMetadataFromId } from "@/lib/room/get";

const DEFAULT_DESCRIPTION =
    "好きな単語リストで、友達と一緒にタイピングゲームをプレイしながら単語を覚えられるオンラインゲーム。";

export async function generateMetadata({
    params,
}: {
    params: Promise<{ slug: string }>;
}): Promise<Metadata> {
    const { slug } = await params;
    const room = await getRoomMetadataFromId(slug);

    if (!room) {
        return {};
    }

    const title = room.title?.trim()
        ? `${room.title.trim()} - Ei-TypeBomb`
        : "Ei-TypeBomb";
    const description = room.explanation?.trim() || DEFAULT_DESCRIPTION;

    return {
        title,
        description,
        robots: room.isPublic
            ? undefined
            : {
                  index: false,
                  follow: false,
              },
        openGraph: {
            title,
            description,
        },
        twitter: {
            title,
            description,
        },
    };
}

export default function RoomLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return children;
}
