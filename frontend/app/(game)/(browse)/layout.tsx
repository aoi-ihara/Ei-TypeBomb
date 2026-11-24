import { RoomListViewerProvider } from "@/components/rooms/RoomListViewerProvider";
import RoomBrowser from "./RoomBrowser";

export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <RoomListViewerProvider>
            <RoomBrowser>{children}</RoomBrowser>
        </RoomListViewerProvider>
    );
}
