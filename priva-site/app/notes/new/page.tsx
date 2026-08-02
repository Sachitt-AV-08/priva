"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Spinner from "../../../components/Spinner";

export default function NewNoteRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/notes?new=1"), [router]);
  return <main className="loading-page"><Spinner label="Opening notes" /></main>;
}
