import { RoomListViewerProvider } from "@/components/rooms/RoomListViewerProvider";

/**
 * Persist only the authenticated viewer state across public feed navigations.
 * Public ISR page HTML remains independent of cookies or user identity.
 */
export default function GameLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    return <RoomListViewerProvider>{children}</RoomListViewerProvider>;
}
