import { redirect } from "next/navigation";

/**
 * Root page redirects to /pricing
 */
export default function Home() {
  redirect("/pricing");
}
