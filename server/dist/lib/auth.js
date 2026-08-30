"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyToken = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const verifyToken = async (jwtToken) => {
    const JWT_SECRET = process.env.JWT_SECRET;
    try {
        const decoded = await new Promise((resolve, reject) => {
            jsonwebtoken_1.default.verify(jwtToken, JWT_SECRET, (err, decodedPayload) => {
                if (err)
                    return reject(err);
                resolve(decodedPayload);
            });
        });
        const roomId = decoded?.id;
        if (!roomId) {
            console.error("Incorrect JWT Token");
            return null;
        }
        return roomId;
    }
    catch (error) {
        console.error("Incorrect JWT Token:", error);
        return null;
    }
};
exports.verifyToken = verifyToken;
