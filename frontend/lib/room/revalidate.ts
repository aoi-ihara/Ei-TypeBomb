import "server-only";
import { revalidatePath } from "next/cache";

/** Refresh only the server data paths affected by room collections. */
export const revalidateRoomLists = () => {
    revalidatePath("/");
    revalidatePath("/mine");
    revalidatePath("/saved");
};

/**
 * Content, aliases and room permissions may have changed. Invalidate all
 * canonical/legacy slugs within room routes without purging the root layout's
 * unrelated paths (account, OAuth, documentation, etc.).
 *
 * Next 16 Server Actions still refresh visited Router Cache entries broadly;
 * these targeted paths are scoped server-data invalidation, not a promise of
 * fine-grained client Router Cache retention.
 */
export const revalidateRoomContent = () => {
    revalidateRoomLists();
    revalidatePath("/[link]", "page");
    revalidatePath("/[link]/edit", "page");
    revalidatePath("/[link]/online", "page");
    revalidatePath("/[link]/offline", "page");
};
