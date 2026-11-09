import { redirect } from "next/navigation";

/** Legacy sign-in URL now opens ETB's own sign-in form. */
export default function Page() {
    redirect("/sign-in");
}
