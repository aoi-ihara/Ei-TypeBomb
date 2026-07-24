import dotenv from "dotenv";
dotenv.config();

import jwt from "jsonwebtoken";

export const verifyToken = async (jwtToken: string): Promise<string | null> => {
    const JWT_SECRET = process.env.JWT_SECRET!;

    try {
        const decoded = await new Promise<any>((resolve, reject) => {
            jwt.verify(jwtToken, JWT_SECRET, (err, decodedPayload) => {
                if (err) return reject(err);
                resolve(decodedPayload);
            });
        });

        const roomId = decoded?.id;

        if (!roomId) {
            console.error("Incorrect JWT Token");
            return null;
        }

        return roomId;
    } catch (error) {
        console.error("Incorrect JWT Token:", error);
        return null;
    }
};
