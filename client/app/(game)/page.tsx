import { cookies } from "next/headers";
import Home from "./Home";

export default async function Page() {
    const cookieStore = await cookies();

    const backgroundMusic =
        cookieStore.get("background-music")?.value !== "false";
    const sounDeffects = cookieStore.get("sound-effects")?.value !== "false";

    return (
        <Home
            initialSounDeffects={sounDeffects}
            initialBackgroundMusic={backgroundMusic}
        />
    );
}
