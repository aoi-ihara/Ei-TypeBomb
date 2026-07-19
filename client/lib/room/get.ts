"use server";

import { createAdminClient } from "../db/server";
import { getUser } from "../auth/session";

export const getMyRooms = async () => {
    const userId = getUser();

    const supabase = await createAdminClient();
};
