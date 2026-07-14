"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AskDataRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/query-workspace?mode=ask");
  }, [router]);
  return null;
}