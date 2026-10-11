import BlinkText from "@/app/NotFoundClient";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "404 ページが見つかりません - vgnz93hs",
};

export default function Loading() {
    return <BlinkText />;
}
