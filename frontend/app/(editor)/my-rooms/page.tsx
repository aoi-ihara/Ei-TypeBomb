import { redirect } from "next/navigation";

export default function LegacyMyRoomsRoute() {
    redirect("/?filter=mine");
}
