"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function QueryStudioRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/query-workspace?mode=sql");
  }, [router]);
  return null;
}